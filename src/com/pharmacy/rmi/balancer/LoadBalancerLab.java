package com.pharmacy.rmi.balancer;

import com.pharmacy.rmi.model.Inventory;
import com.pharmacy.rmi.model.Medicine;
import com.pharmacy.rmi.model.NodeSearchResult;
import com.pharmacy.rmi.model.PharmacyBranch;
import com.pharmacy.rmi.model.Prescription;
import com.pharmacy.rmi.model.SearchRequest;
import com.pharmacy.rmi.model.SearchType;
import com.pharmacy.rmi.server.PharmacyData;
import com.pharmacy.rmi.server.PharmacyNode;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.TreeMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * The load-balancing lab behind /api/load-balancer.
 *
 * This is a working balancer, not a drawing of one. A run puts real search requests through
 * the chosen algorithm and each one is executed: over RMI when the branch node is listening,
 * otherwise by the gateway itself against the same PostgreSQL-backed dataset. Latency,
 * queue depth and failures are measured, never invented, and every decision records the
 * reason the algorithm chose that backend.
 *
 * Health is tracked per backend with a circuit breaker, so a node the operator crashes
 * leaves the pool after its failures trip the breaker and rejoins through a half-open probe.
 */
public final class LoadBalancerLab {

    /** Registry ports and the branch each node owns — the same six nodes as the rest of the system. */
    private static final List<Backend> BACKENDS = List.of(
            new Backend(1, "Mumbai", 1099, "BR-MUM-02", 5),
            new Backend(2, "Pune", 1100, "BR-PUN-06", 3),
            new Backend(3, "Bengaluru", 1101, "BR-BLR-03", 4),
            new Backend(4, "Delhi", 1102, "BR-DEL-01", 5),
            new Backend(5, "Hyderabad", 1103, "BR-HYD-04", 2),
            new Backend(6, "Chennai", 1104, "BR-CHN-05", 3));

    private static final String[] KEYS = {
            "MED-0001", "MED-0002", "MED-0003", "MED-0004", "MED-0005", "MED-0006",
            "Paracetamol", "Amoxicillin", "Azithromycin", "Metformin", "Insulin", "Morphine",
            "Ayesha Khan", "Rahul Verma", "DISP-BR01", "BR-MUM-02", "Cipla", "Sun Pharma" };

    private static final int MAX_REQUESTS = 600;
    private static final int MAX_CONCURRENCY = 32;
    private static final int TRACE_LIMIT = 80;
    private static final int BREAKER_THRESHOLD = 3;          // consecutive failures before the breaker opens
    private static final long BREAKER_COOLDOWN_MS = 6_000;   // how long it stays open before a half-open probe
    private static final int RING_VNODES = 160;              // virtual nodes per backend on the hash ring

    private volatile Strategy strategy = Strategy.ROUND_ROBIN;
    private volatile Skew skew = Skew.UNIFORM;
    private volatile int requests = 120;
    private volatile int concurrency = 8;

    /** Guards the algorithms' shared selection state. Never the lab monitor: a run holds that
     *  for its whole duration, so workers taking it would deadlock against their own dispatcher. */
    private final Object pickLock = new Object();
    private final AtomicInteger cursor = new AtomicInteger();      // round robin
    private final Deque<Trace> trace = new ArrayDeque<>();
    private final List<RunSummary> history = new ArrayList<>();
    private final List<RunSummary> comparison = new ArrayList<>();
    private final TreeMap<Long, Backend> ring = new TreeMap<>();
    private volatile RunSummary lastRun;
    private volatile String lastAction = "Lab ready. Pick an algorithm and dispatch a burst.";
    private volatile boolean busy;
    private final AtomicInteger runCounter = new AtomicInteger();
    private final AtomicLong sequence = new AtomicLong();

    public LoadBalancerLab() {
        rebuildRing();
    }

    // ── configuration and operator actions ──────────────────────────────────

    public synchronized Snapshot apply(String action, Map<String, String> params) {
        switch (action == null ? "" : action.trim().toLowerCase(Locale.ROOT)) {
            case "strategy" -> {
                strategy = Strategy.parse(params.get("value"));
                cursor.set(0);
                BACKENDS.forEach(b -> b.currentWeight = 0);
                lastAction = "Algorithm set to " + strategy.label() + ".";
            }
            case "workload" -> {
                requests = clamp(intOf(params.get("requests"), requests), 10, MAX_REQUESTS);
                concurrency = clamp(intOf(params.get("concurrency"), concurrency), 1, MAX_CONCURRENCY);
                skew = Skew.parse(params.getOrDefault("skew", skew.name()));
                lastAction = "Workload set to " + requests + " requests at concurrency " + concurrency
                        + " with a " + skew.label().toLowerCase(Locale.ROOT) + " key mix.";
            }
            case "weight" -> {
                Backend backend = backend(params.get("node"));
                backend.weight = clamp(intOf(params.get("value"), backend.weight), 1, 10);
                rebuildRing();
                lastAction = backend.name + " weight set to " + backend.weight + ".";
            }
            case "slow" -> {
                Backend backend = backend(params.get("node"));
                backend.addedLatencyMs = clamp(intOf(params.get("value"), 0), 0, 400);
                lastAction = backend.addedLatencyMs == 0
                        ? backend.name + " latency penalty cleared."
                        : backend.name + " given a " + backend.addedLatencyMs + " ms latency penalty.";
            }
            case "fail" -> {
                Backend backend = backend(params.get("node"));
                backend.operatorDown = true;
                lastAction = backend.name + " crashed. It stays in the pool until "
                        + BREAKER_THRESHOLD + " failures trip its breaker — dispatch a burst to watch that happen.";
            }
            case "recover" -> {
                Backend backend = backend(params.get("node"));
                backend.operatorDown = false;
                backend.breakerOpenedAt = 0;
                backend.consecutiveFailures.set(0);
                backend.breaker = "CLOSED";
                lastAction = backend.name + " recovered and returned to the pool.";
            }
            case "run" -> runBurst();
            case "compare" -> compareAll();
            case "reset" -> resetLab();
            case "" -> { /* plain snapshot */ }
            default -> throw new IllegalArgumentException("Unknown load balancer action: " + action);
        }
        return snapshot();
    }

    private void resetLab() {
        BACKENDS.forEach(Backend::reset);
        trace.clear();
        history.clear();
        comparison.clear();
        lastRun = null;
        cursor.set(0);
        sequence.set(0);
        runCounter.set(0);
        strategy = Strategy.ROUND_ROBIN;
        skew = Skew.UNIFORM;
        requests = 120;
        concurrency = 8;
        rebuildRing();
        lastAction = "Lab reset. Every node is healthy, every counter is zero.";
    }

    // ── the run itself ──────────────────────────────────────────────────────

    private void runBurst() {
        lastRun = execute(strategy, true);
        history.add(0, lastRun);
        while (history.size() > 8) history.remove(history.size() - 1);
        comparison.clear();
        lastAction = String.format("%s dispatched %d requests at concurrency %d in %.2f ms — %.0f req/s.",
                strategy.label(), lastRun.requests(), lastRun.concurrency(), lastRun.durationMs(), lastRun.throughput());
    }

    /** Runs the identical workload through every algorithm so the table compares like with like. */
    private void compareAll() {
        comparison.clear();
        Strategy chosen = strategy;
        Strategy[] all = Strategy.values();
        int keptAt = 0;
        for (int i = 0; i < all.length; i++) {
            if (all[i] == chosen) { keptAt = i; comparison.add(null); continue; }
            comparison.add(execute(all[i], false));
        }
        // the selected algorithm runs last and keeps its counters: every run starts by clearing
        // them, so running it earlier would leave the pool and the flow diagram showing zeroes
        RunSummary kept = execute(chosen, true);
        comparison.set(keptAt, kept);
        lastRun = kept;
        lastAction = "Compared all " + all.length + " algorithms over the same "
                + requests + "-request workload. The pool below shows " + chosen.label() + ".";
    }

    /**
     * Dispatches one burst. {@code keepStats} decides whether the per-node counters the page
     * draws are left holding this run (a normal run) or restored afterwards (a comparison pass).
     */
    private RunSummary execute(Strategy using, boolean keepStats) {
        busy = true;
        try {
            BACKENDS.forEach(Backend::resetRun);
            cursor.set(0);
            BACKENDS.forEach(b -> b.currentWeight = 0);
            probeAll();
            warmUp();

            int total = requests;
            int lanes = Math.min(concurrency, total);
            long[] latencies = new long[total];
            AtomicInteger index = new AtomicInteger();
            AtomicInteger errors = new AtomicInteger();
            AtomicInteger rejected = new AtomicInteger();
            ExecutorService pool = Executors.newFixedThreadPool(lanes);
            CountDownLatch done = new CountDownLatch(total);
            List<Trace> runTrace = new ArrayList<>();
            long startedAt = System.nanoTime();

            for (int i = 0; i < total; i++) {
                final int ordinal = i;
                pool.execute(() -> {
                    String key = key(ordinal);
                    Pick pick;
                    long seq;
                    // the number is taken inside the lock, with the decision it labels: taken
                    // outside it, concurrent lanes would number their picks out of order and the
                    // trace would show a node being chosen before the state that chose it
                    synchronized (pickLock) {
                        seq = sequence.incrementAndGet();
                        pick = choose(using, key);
                    }
                    if (pick == null) {
                        rejected.incrementAndGet();
                        errors.incrementAndGet();
                        latencies[index.getAndIncrement()] = 0;
                        synchronized (runTrace) {
                            runTrace.add(new Trace(seq, key, "—", "NO HEALTHY BACKEND", 0, "NONE", "REJECTED"));
                        }
                        done.countDown();
                        return;
                    }
                    Backend backend = pick.backend();
                    backend.dispatched.incrementAndGet();
                    backend.inFlight.incrementAndGet();
                    long began = System.nanoTime();
                    String status = "OK";
                    String transport = "LOCAL";
                    try {
                        transport = dispatch(backend, key);
                        backend.completed.incrementAndGet();
                        backend.onSuccess();
                    } catch (Exception failure) {
                        status = "FAILED";
                        backend.failed.incrementAndGet();
                        backend.onFailure();
                        errors.incrementAndGet();
                    } finally {
                        long micros = (System.nanoTime() - began) / 1_000;
                        backend.inFlight.decrementAndGet();
                        backend.record(micros);
                        latencies[index.getAndIncrement()] = micros;
                        synchronized (runTrace) {
                            runTrace.add(new Trace(seq, key, backend.name, pick.reason(),
                                    micros / 1000.0, transport, status));
                        }
                        done.countDown();
                    }
                });
            }
            try { done.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            pool.shutdown();
            // measured in nanos: at these speeds a whole burst can finish inside one millisecond,
            // and rounding the duration up to 1 ms would report a throughput several times too high
            double durationMs = Math.max(0.001, (System.nanoTime() - startedAt) / 1_000_000.0);

            List<NodeShare> shares = BACKENDS.stream().map(b -> new NodeShare(
                    b.name, b.branchCode, b.dispatched.get(), b.completed.get(), b.failed.get(),
                    total == 0 ? 0 : b.dispatched.get() * 100.0 / total, round(b.ewmaMs))).toList();

            RunSummary summary = new RunSummary(
                    runCounter.incrementAndGet(), using.name(), using.label(), total, lanes, skew.name(),
                    round(durationMs), round(total * 1000.0 / durationMs),
                    round(percentile(latencies, 50) / 1000.0), round(percentile(latencies, 95) / 1000.0),
                    round(percentile(latencies, 99) / 1000.0), round(mean(latencies) / 1000.0),
                    errors.get(), rejected.get(), round(fairness()), round(spread()), shares);

            if (keepStats) {
                synchronized (trace) {
                    // oldest first onto the front of the deque, so the deque reads latest first
                    runTrace.sort((a, b) -> Long.compare(a.sequence(), b.sequence()));
                    runTrace.forEach(trace::addFirst);
                    while (trace.size() > TRACE_LIMIT) trace.removeLast();
                }
            } else {
                BACKENDS.forEach(Backend::resetRun);
            }
            return summary;
        } finally {
            busy = false;
        }
    }

    /** Executes the request on that backend: over RMI when it answers, otherwise here. */
    private String dispatch(Backend backend, String key) throws Exception {
        if (backend.operatorDown) throw new IllegalStateException(backend.name + " is down");
        if (backend.addedLatencyMs > 0) Thread.sleep(backend.addedLatencyMs);
        if (backend.reachable) {
            try {
                PharmacyNode node = backend.stub();
                NodeSearchResult result = node.search(new SearchRequest(SearchType.ANY, key, sequence.get()));
                backend.lastMatches = result.getMatches().size();
                return "RMI";
            } catch (Exception rmiFailure) {
                backend.reachable = false;   // fall through to local work, and let the probe re-decide
            }
        }
        backend.lastMatches = localWork(backend, key);
        return "LOCAL";
    }

    /**
     * The same read the RMI node would do, run in the gateway: scan this node's own branch for
     * the key. Real work over the real dataset, so the measured latency means something.
     */
    private static int localWork(Backend backend, String key) {
        String q = key.toLowerCase(Locale.ROOT);
        PharmacyBranch branch = PharmacyData.branchByCode(backend.branchCode);
        String branchId = branch == null ? "" : branch.id();
        int matches = 0;
        MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (Exception e) { throw new IllegalStateException(e); }
        for (Medicine medicine : PharmacyData.medicines()) {
            if (medicine.code().toLowerCase(Locale.ROOT).contains(q)
                    || medicine.name().toLowerCase(Locale.ROOT).contains(q)
                    || medicine.genericName().toLowerCase(Locale.ROOT).contains(q)
                    || medicine.manufacturer().toLowerCase(Locale.ROOT).contains(q)) matches++;
        }
        for (Prescription prescription : PharmacyData.prescriptions()) {
            if (!prescription.branchId().equals(branchId)) continue;
            // the integrity pass every node runs before it trusts a prescription: real CPU cost,
            // so a request occupies the backend long enough for queueing to be observable
            digest.reset();
            digest.update((prescription.id() + prescription.patientId() + prescription.medicineId()
                    + prescription.quantity() + prescription.issueDate()).getBytes(StandardCharsets.UTF_8));
            if (digest.digest()[0] == 0) matches++;   // keeps the compiler from eliding the work
            if (prescription.patientName().toLowerCase(Locale.ROOT).contains(q)
                    || prescription.doctorName().toLowerCase(Locale.ROOT).contains(q)
                    || prescription.id().toLowerCase(Locale.ROOT).contains(q)) matches++;
        }
        for (Inventory row : PharmacyData.inventory()) {
            if (row.branchId().equals(branchId)) matches++;
        }
        return matches;
    }

    // ── the algorithms ──────────────────────────────────────────────────────

    /** Applies the algorithm and returns the chosen backend together with the reason it won. */
    private Pick choose(Strategy using, String key) {
        List<Backend> pool = BACKENDS.stream().filter(Backend::selectable).toList();
        if (pool.isEmpty()) return null;

        return switch (using) {
            case ROUND_ROBIN -> {
                int at = Math.floorMod(cursor.getAndIncrement(), pool.size());
                yield new Pick(pool.get(at), "cursor " + at + " of " + pool.size() + " healthy");
            }
            case RANDOM -> {
                Backend picked = pool.get(ThreadLocalRandom.current().nextInt(pool.size()));
                yield new Pick(picked, "uniform over " + pool.size() + " healthy");
            }
            case WEIGHTED_ROUND_ROBIN -> {
                int totalWeight = pool.stream().mapToInt(b -> b.weight).sum();
                Backend best = null;
                for (Backend backend : pool) {
                    backend.currentWeight += backend.weight;
                    if (best == null || backend.currentWeight > best.currentWeight) best = backend;
                }
                best.currentWeight -= totalWeight;
                yield new Pick(best, "weight " + best.weight + " of " + totalWeight + ", highest running total");
            }
            case LEAST_CONNECTIONS -> {
                Backend best = pool.get(0);
                for (Backend backend : pool) {
                    int a = backend.inFlight.get(), b = best.inFlight.get();
                    // tie on queue depth falls back to whoever has taken least so far (HAProxy's rule),
                    // otherwise an idle pool would send every request to the same node
                    if (a < b || (a == b && backend.dispatched.get() < best.dispatched.get())) best = backend;
                }
                yield new Pick(best, "in-flight " + best.inFlight.get() + ", lowest of " + pool.size());
            }
            case LEAST_RESPONSE_TIME -> {
                // a backend with no measurement yet is given slow start: it is tried before
                // any measured node, so the score is never decided on missing data
                List<Backend> unmeasured = pool.stream().filter(b -> b.ewmaMs == 0).toList();
                if (!unmeasured.isEmpty()) {
                    Backend fresh = unmeasured.stream()
                            .min((a, b) -> Long.compare(a.dispatched.get(), b.dispatched.get())).orElseThrow();
                    yield new Pick(fresh, "slow start: no latency sample yet");
                }
                Backend best = pool.get(0);
                double bestScore = Double.MAX_VALUE;
                for (Backend backend : pool) {
                    double score = backend.ewmaMs * (backend.inFlight.get() + 1);
                    if (score < bestScore) { bestScore = score; best = backend; }
                }
                yield new Pick(best, String.format("score %.2f = %.2f ms ewma x %d queued",
                        bestScore, best.ewmaMs, best.inFlight.get() + 1));
            }
            case POWER_OF_TWO -> {
                Random random = ThreadLocalRandom.current();
                Backend first = pool.get(random.nextInt(pool.size()));
                Backend second = pool.size() == 1 ? first : pool.get(random.nextInt(pool.size()));
                boolean firstWins = first.inFlight.get() < second.inFlight.get()
                        || (first.inFlight.get() == second.inFlight.get()
                            && first.dispatched.get() <= second.dispatched.get());
                Backend best = firstWins ? first : second;
                yield new Pick(best, "sampled " + first.name + "(" + first.inFlight.get() + ") and "
                        + second.name + "(" + second.inFlight.get() + ")");
            }
            case CONSISTENT_HASH -> {
                long hash = hash(key);
                Map.Entry<Long, Backend> entry = ring.ceilingEntry(hash);
                if (entry == null) entry = ring.firstEntry();
                Backend candidate = entry.getValue();
                String reason = "key hash " + Long.toHexString(hash).substring(0, 8) + " -> ring slot";
                if (!candidate.selectable()) {   // walk the ring to the next healthy owner
                    Backend fallback = null;
                    for (Map.Entry<Long, Backend> next : ring.tailMap(entry.getKey(), false).entrySet()) {
                        if (next.getValue().selectable()) { fallback = next.getValue(); break; }
                    }
                    if (fallback == null) for (Backend backend : ring.values()) {
                        if (backend.selectable()) { fallback = backend; break; }
                    }
                    reason = candidate.name + " unhealthy, ring moved on to " + (fallback == null ? "—" : fallback.name);
                    candidate = fallback;
                }
                yield candidate == null ? null : new Pick(candidate, reason);
            }
        };
    }

    /** SHA-256 based ring: 160 virtual nodes per backend, scaled by weight so weights hold here too. */
    private void rebuildRing() {
        ring.clear();
        for (Backend backend : BACKENDS) {
            int vnodes = Math.max(1, RING_VNODES * backend.weight / 5);
            for (int i = 0; i < vnodes; i++) ring.put(hash(backend.name + "#" + i), backend);
        }
    }

    private static long hash(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            long result = 0;
            for (int i = 0; i < 8; i++) result = (result << 8) | (digest[i] & 0xffL);
            return result >>> 1;   // keep it positive so the ring orders naturally
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ── health ──────────────────────────────────────────────────────────────

    /** Touches the dataset once before timing, so the first request does not pay for the
     *  PostgreSQL read that every later one gets from the 2-second cache. */
    private void warmUp() {
        PharmacyData.branches();
        PharmacyData.medicines();
        PharmacyData.prescriptions();
        PharmacyData.inventory();
        for (Backend backend : BACKENDS) localWork(backend, "warmup");
    }

    private void probeAll() {
        for (Backend backend : BACKENDS) {
            backend.reachable = !backend.operatorDown && canConnect(backend.port);
            if (backend.breakerOpenedAt > 0
                    && System.currentTimeMillis() - backend.breakerOpenedAt > BREAKER_COOLDOWN_MS) {
                backend.breaker = "HALF_OPEN";   // let exactly one request through to test the water
            }
        }
    }

    private static boolean canConnect(int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), 250);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // ── workload shaping ────────────────────────────────────────────────────

    private String key(int ordinal) {
        return switch (skew) {
            case UNIFORM -> KEYS[ThreadLocalRandom.current().nextInt(KEYS.length)];
            case SEQUENTIAL -> KEYS[ordinal % KEYS.length];
            // 80/20: four requests in five ask for the same hot key
            case HOT_KEY -> ThreadLocalRandom.current().nextInt(100) < 80
                    ? KEYS[0] : KEYS[ThreadLocalRandom.current().nextInt(KEYS.length)];
        };
    }

    // ── statistics ──────────────────────────────────────────────────────────

    /** Jain's fairness index over dispatch counts: 1.0 is a perfectly even split. */
    private double fairness() {
        List<Backend> pool = BACKENDS.stream().filter(b -> b.dispatched.get() > 0).toList();
        if (pool.isEmpty()) return 0;
        double sum = 0, squares = 0;
        for (Backend backend : pool) {
            double x = backend.dispatched.get();
            sum += x;
            squares += x * x;
        }
        return squares == 0 ? 0 : (sum * sum) / (pool.size() * squares);
    }

    /** Percentage-point gap between the busiest and quietest node that took traffic. */
    private double spread() {
        List<Backend> pool = BACKENDS.stream().filter(b -> b.dispatched.get() > 0).toList();
        if (pool.isEmpty()) return 0;
        long total = pool.stream().mapToLong(b -> b.dispatched.get()).sum();
        double max = pool.stream().mapToLong(b -> b.dispatched.get()).max().orElse(0) * 100.0 / total;
        double min = pool.stream().mapToLong(b -> b.dispatched.get()).min().orElse(0) * 100.0 / total;
        return max - min;
    }

    private static double percentile(long[] values, int p) {
        long[] sorted = Arrays.stream(values).filter(v -> v > 0).sorted().toArray();
        if (sorted.length == 0) return 0;
        int at = (int) Math.ceil(p / 100.0 * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(at, sorted.length - 1))];
    }

    private static double mean(long[] values) {
        long[] kept = Arrays.stream(values).filter(v -> v > 0).toArray();
        return kept.length == 0 ? 0 : Arrays.stream(kept).average().orElse(0);
    }

    private static double round(double value) { return Math.round(value * 100.0) / 100.0; }

    // ── snapshot ────────────────────────────────────────────────────────────

    public synchronized Snapshot snapshot() {
        List<BackendView> views = BACKENDS.stream().map(backend -> new BackendView(
                backend.id, backend.name, backend.port, backend.branchCode, backend.weight,
                backend.addedLatencyMs, backend.health(), backend.breaker, backend.reachable,
                backend.operatorDown, backend.inFlight.get(), backend.dispatched.get(),
                backend.completed.get(), backend.failed.get(), round(backend.ewmaMs),
                round(backend.peakMs), backend.lastMatches,
                lastRun == null || lastRun.requests() == 0 ? 0
                        : round(backend.dispatched.get() * 100.0 / lastRun.requests()))).toList();

        List<StrategyView> strategies = Arrays.stream(Strategy.values()).map(s -> new StrategyView(
                s.name(), s.label(), s.formula(), s.how(), s.why(), s.keyed(), s == strategy)).toList();

        synchronized (trace) {
            return new Snapshot(strategy.name(), strategy.label(), strategy.formula(), strategy.how(),
                    strategy.why(), requests, concurrency, skew.name(), skew.label(), busy, lastAction,
                    views, strategies, lastRun, List.copyOf(history), List.copyOf(comparison),
                    new ArrayList<>(trace));
        }
    }

    // ── types ───────────────────────────────────────────────────────────────

    private record Pick(Backend backend, String reason) {}

    public enum Skew {
        UNIFORM("Uniform"), SEQUENTIAL("Sequential"), HOT_KEY("Hot key 80/20");

        private final String label;
        Skew(String label) { this.label = label; }
        public String label() { return label; }
        public static Skew parse(String raw) {
            if (raw == null || raw.isBlank()) return UNIFORM;
            String name = raw.trim().toUpperCase(Locale.ROOT).replace('-', '_');
            for (Skew value : values()) if (value.name().equals(name)) return value;
            throw new IllegalArgumentException("Unknown key mix: " + raw);
        }
    }

    /** One backend in the pool: its configuration, its live health, and its measured behaviour. */
    private static final class Backend {
        final int id;
        final String name;
        final int port;
        final String branchCode;
        volatile int weight;
        volatile int addedLatencyMs;
        volatile boolean operatorDown;
        volatile boolean reachable;
        volatile String breaker = "CLOSED";
        volatile long breakerOpenedAt;
        volatile double ewmaMs;
        volatile double peakMs;
        volatile int lastMatches;
        int currentWeight;                       // guarded by the lab's monitor (smooth WRR)
        private volatile PharmacyNode stub;

        final AtomicInteger inFlight = new AtomicInteger();
        final AtomicInteger consecutiveFailures = new AtomicInteger();
        final AtomicLong dispatched = new AtomicLong();
        final AtomicLong completed = new AtomicLong();
        final AtomicLong failed = new AtomicLong();

        Backend(int id, String name, int port, String branchCode, int weight) {
            this.id = id;
            this.name = name;
            this.port = port;
            this.branchCode = branchCode;
            this.weight = weight;
        }

        PharmacyNode stub() throws Exception {
            PharmacyNode current = stub;
            if (current == null) {
                Registry registry = LocateRegistry.getRegistry("127.0.0.1", port);
                current = (PharmacyNode) registry.lookup(name);
                stub = current;
            }
            return current;
        }

        /**
         * Only an open breaker removes a backend from selection. A node the operator has
         * crashed stays selectable until its failures are actually observed — that detection
         * gap is the thing worth watching, and hiding it would make the breaker decorative.
         */
        boolean selectable() { return !"OPEN".equals(breaker); }

        String health() {
            if ("OPEN".equals(breaker)) return "CIRCUIT_OPEN";
            if ("HALF_OPEN".equals(breaker)) return "PROBING";
            if (operatorDown) return "FAILING";   // crashed, but the balancer has not noticed yet
            return reachable ? "HEALTHY_RMI" : "HEALTHY_LOCAL";
        }

        void record(long micros) {
            double ms = micros / 1000.0;
            // exponentially weighted mean, alpha 0.2: recent requests dominate without erasing history
            ewmaMs = ewmaMs == 0 ? ms : ewmaMs * 0.8 + ms * 0.2;
            if (ms > peakMs) peakMs = ms;
        }

        void onSuccess() {
            consecutiveFailures.set(0);
            if (!"CLOSED".equals(breaker)) {
                breaker = "CLOSED";
                breakerOpenedAt = 0;
            }
        }

        void onFailure() {
            stub = null;
            if (consecutiveFailures.incrementAndGet() >= BREAKER_THRESHOLD && !"OPEN".equals(breaker)) {
                breaker = "OPEN";
                breakerOpenedAt = System.currentTimeMillis();
            }
        }

        /** Clears the counters a single run owns, keeping configuration and health. */
        void resetRun() {
            dispatched.set(0);
            completed.set(0);
            failed.set(0);
            inFlight.set(0);
            ewmaMs = 0;
            peakMs = 0;
        }

        void reset() {
            resetRun();
            operatorDown = false;
            addedLatencyMs = 0;
            breaker = "CLOSED";
            breakerOpenedAt = 0;
            consecutiveFailures.set(0);
            currentWeight = 0;
            lastMatches = 0;
            stub = null;
            weight = switch (id) { case 1, 4 -> 5; case 3 -> 4; case 2, 6 -> 3; default -> 2; };
        }
    }

    public record BackendView(int id, String name, int port, String branchCode, int weight,
                              int addedLatencyMs, String health, String breaker, boolean reachable,
                              boolean operatorDown, int inFlight, long dispatched, long completed,
                              long failed, double ewmaMs, double peakMs, int lastMatches, double sharePercent) {}

    public record StrategyView(String id, String label, String formula, String how, String why,
                               boolean keyed, boolean active) {}

    public record NodeShare(String node, String branchCode, long dispatched, long completed,
                            long failed, double sharePercent, double ewmaMs) {}

    public record RunSummary(int run, String strategy, String strategyLabel, int requests, int concurrency,
                             String skew, double durationMs, double throughput, double p50Ms, double p95Ms,
                             double p99Ms, double meanMs, int errors, int rejected, double fairness,
                             double spreadPercent, List<NodeShare> shares) {}

    public record Trace(long sequence, String key, String node, String reason, double latencyMs,
                        String transport, String status) {}

    public record Snapshot(String strategy, String strategyLabel, String formula, String how, String why,
                           int requests, int concurrency, String skew, String skewLabel, boolean busy,
                           String lastAction, List<BackendView> backends, List<StrategyView> strategies,
                           RunSummary lastRun, List<RunSummary> history, List<RunSummary> comparison,
                           List<Trace> trace) {}

    // ── helpers ─────────────────────────────────────────────────────────────

    private static Backend backend(String name) {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("Name a node.");
        return BACKENDS.stream().filter(b -> b.name.equalsIgnoreCase(name.trim())).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown node: " + name));
    }

    private static int intOf(String value, int fallback) {
        try { return Integer.parseInt(value.trim()); } catch (Exception e) { return fallback; }
    }

    private static int clamp(int value, int low, int high) { return Math.max(low, Math.min(high, value)); }
}
