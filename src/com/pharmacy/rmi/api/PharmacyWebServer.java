package com.pharmacy.rmi.api;

import com.pharmacy.rmi.model.DispensingTransaction;
import com.pharmacy.rmi.model.Inventory;
import com.pharmacy.rmi.model.Medicine;
import com.pharmacy.rmi.model.NodeSearchResult;
import com.pharmacy.rmi.model.PharmacyBranch;
import com.pharmacy.rmi.model.Prescription;
import com.pharmacy.rmi.model.SearchRequest;
import com.pharmacy.rmi.model.SearchResponse;
import com.pharmacy.rmi.model.SearchType;
import com.pharmacy.rmi.server.PharmacyData;
import com.pharmacy.rmi.server.PharmacyRouter;
import com.pharmacy.rmi.server.RecordWriter;
import com.pharmacy.rmi.balancer.LoadBalancerLab;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.rmi.registry.LocateRegistry;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.net.Socket;

/**
 * Same-origin browser gateway for the supplied RMI pharmacy system.
 *
 * The gateway reads the PostgreSQL dataset, probes the six RMI node registries, and
 * accepts add/update writes from the data explorer (POST /api/records). The original
 * RMI servers remain the distributed runtime.
 */
public final class PharmacyWebServer {
    private PharmacyWebServer() {}

    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(System.getProperty("pharmacy.web.port", "8080"));
        Path root = Path.of(System.getProperty("pharmacy.web.root", "."))
                .toAbsolutePath()
                .normalize();

        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
        ApiService service = new ApiService();
        server.createContext("/api", new ApiHandler(service));
        server.createContext("/", new StaticHandler(root));
        server.setExecutor(Executors.newFixedThreadPool(8));
        Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(0), "pharmacy-web-shutdown"));
        server.start();

        System.out.println("Helixis web gateway listening on http://localhost:" + port);
        System.out.println("Serving project root: " + root);
        System.out.println("API: /api/overview, /api/network, /api/search, /api/database");
    }

    private static final class ApiHandler implements HttpHandler {
        private final ApiService service;

        private ApiHandler(ApiService service) {
            this.service = service;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            addCors(exchange.getResponseHeaders());
            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                exchange.close();
                return;
            }
            try {
                URI uri = exchange.getRequestURI();
                String path = uri.getPath();
                String endpoint = path.length() <= 4 ? "/" : path.substring(4);
                Map<String, String> query = query(uri.getRawQuery());
                if ("GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                    sendJson(exchange, 200, service.handle(endpoint, query));
                    return;
                }
                if ("POST".equalsIgnoreCase(exchange.getRequestMethod()) && "/fault-tolerance/action".equals(endpoint)) {
                    sendJson(exchange, 200, service.handleFaultToleranceAction(query.getOrDefault("action", "")));
                    return;
                }
                if ("POST".equalsIgnoreCase(exchange.getRequestMethod()) && "/load-balancer/action".equals(endpoint)) {
                    sendJson(exchange, 200, service.handleLoadBalancerAction(query));
                    return;
                }
                if ("POST".equalsIgnoreCase(exchange.getRequestMethod()) && "/records".equals(endpoint)) {
                    // body is form-encoded; ?id=… means update, otherwise insert
                    Map<String, String> body = query(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                    String dataset = query.getOrDefault("dataset", "");
                    String id = query.get("id");
                    String saved = id == null || id.isBlank()
                            ? RecordWriter.insert(dataset, body)
                            : RecordWriter.update(dataset, id, body);
                    sendJson(exchange, 200, Json.object(Json.field("status", "saved"), Json.field("id", saved),
                            Json.field("mode", id == null || id.isBlank() ? "insert" : "update")));
                    return;
                }
                sendJson(exchange, 405, Json.object(Json.field("error", "Method not allowed")));
            } catch (Exception error) {
                int status = error instanceof IllegalArgumentException ? 400 : 500;
                sendJson(exchange, status, Json.object(
                        Json.field("error", status == 400 ? "Invalid request" : "The gateway could not complete this request"),
                        Json.field("detail", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage())));
            }
        }

        private static Map<String, String> query(String rawQuery) {
            Map<String, String> values = new HashMap<>();
            if (rawQuery == null || rawQuery.isBlank()) return values;
            for (String part : rawQuery.split("&")) {
                String[] pair = part.split("=", 2);
                String key = decode(pair[0]);
                String value = pair.length == 2 ? decode(pair[1]) : "";
                values.put(key, value);
            }
            return values;
        }

        private static String decode(String value) {
            return URLDecoder.decode(value, StandardCharsets.UTF_8);
        }

        private static void addCors(Headers headers) {
            headers.set("Access-Control-Allow-Origin", "*");
            headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            headers.set("Access-Control-Allow-Headers", "Content-Type");
            headers.set("Cache-Control", "no-store");
        }

        private static void sendJson(HttpExchange exchange, int status, String body) throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(bytes);
            }
        }
    }

    private static final class StaticHandler implements HttpHandler {
        private final Path root;

        private StaticHandler(Path root) {
            this.root = root;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(405, -1);
                exchange.close();
                return;
            }

            String requestPath = exchange.getRequestURI().getPath();
            String relative = requestPath.equals("/") ? "index.html" : requestPath.substring(1);
            Path target = root.resolve(relative).normalize();
            if (!target.startsWith(root)) {
                exchange.sendResponseHeaders(403, -1);
                exchange.close();
                return;
            }
            if (Files.isDirectory(target)) target = target.resolve("index.html");
            if (!Files.exists(target) || !Files.isRegularFile(target)) {
                byte[] notFound = "Not found".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(404, notFound.length);
                try (OutputStream output = exchange.getResponseBody()) {
                    output.write(notFound);
                }
                return;
            }

            exchange.getResponseHeaders().set("Content-Type", contentType(target));
            long length = Files.size(target);
            exchange.sendResponseHeaders(200, length);
            try (OutputStream output = exchange.getResponseBody()) {
                Files.copy(target, output);
            }
        }

        private static String contentType(Path file) {
            String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
            if (name.endsWith(".html")) return "text/html; charset=utf-8";
            if (name.endsWith(".css")) return "text/css; charset=utf-8";
            if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
            if (name.endsWith(".json")) return "application/json; charset=utf-8";
            if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
            if (name.endsWith(".png")) return "image/png";
            if (name.endsWith(".mp4")) return "video/mp4";
            if (name.endsWith(".svg")) return "image/svg+xml";
            return "application/octet-stream";
        }
    }

    private static final class ApiService {
        private static final List<NodeDefinition> NODES = List.of(
                new NodeDefinition(1, "Mumbai", 1099, "BR-MUM-02"),
                new NodeDefinition(2, "Pune", 1100, "BR-PUN-06"),
                new NodeDefinition(3, "Bengaluru", 1101, "BR-BLR-03"),
                new NodeDefinition(4, "Delhi", 1102, "BR-DEL-01"),
                new NodeDefinition(5, "Hyderabad", 1103, "BR-HYD-04"),
                new NodeDefinition(6, "Chennai", 1104, "BR-CHN-05"));

        private String handle(String endpoint, Map<String, String> query) {
            return switch (endpoint) {
                case "/", "" -> Json.object(
                        Json.field("service", "Helixis pharmacy gateway"),
                        Json.field("status", "ready"),
                        Json.raw("endpoints", Json.stringArray(List.of(
                                "/api/overview", "/api/network", "/api/branches", "/api/medicines",
                                "/api/prescriptions", "/api/inventory", "/api/transactions", "/api/search", "/api/database", "/api/fault-tolerance"))));
                case "/health" -> healthJson();
                case "/overview" -> overviewJson();
                case "/network" -> networkJson();
                case "/branches" -> branchesJson();
                case "/medicines" -> medicinesJson();
                case "/prescriptions" -> prescriptionsJson();
                case "/inventory" -> inventoryJson();
                case "/transactions" -> transactionsJson();
                case "/database" -> databaseJson();
                case "/fault-tolerance" -> faultToleranceJson();
                case "/load-balancer" -> loadBalancerJson(balancer.snapshot());
                case "/search" -> searchJson(query.getOrDefault("type", "ANY"), query.getOrDefault("q", ""));
                default -> Json.object(Json.field("error", "Unknown API route"), Json.field("path", endpoint));
            };
        }

        private final PrimaryBackupSimulation faultTolerance = new PrimaryBackupSimulation();
        private final LoadBalancerLab balancer = new LoadBalancerLab();

        private String handleLoadBalancerAction(Map<String, String> query) {
            return loadBalancerJson(balancer.apply(query.getOrDefault("action", ""), query));
        }

        private static String loadBalancerJson(LoadBalancerLab.Snapshot lab) {
            List<String> backends = lab.backends().stream().map(node -> Json.object(
                    Json.number("id", node.id()), Json.field("name", node.name()),
                    Json.number("port", node.port()), Json.field("branchCode", node.branchCode()),
                    Json.number("weight", node.weight()), Json.number("addedLatencyMs", node.addedLatencyMs()),
                    Json.field("health", node.health()), Json.field("breaker", node.breaker()),
                    Json.bool("reachable", node.reachable()), Json.bool("operatorDown", node.operatorDown()),
                    Json.number("inFlight", node.inFlight()), Json.number("dispatched", node.dispatched()),
                    Json.number("completed", node.completed()), Json.number("failed", node.failed()),
                    Json.decimal("ewmaMs", node.ewmaMs()), Json.decimal("peakMs", node.peakMs()),
                    Json.number("lastMatches", node.lastMatches()),
                    Json.decimal("sharePercent", node.sharePercent()))).toList();

            List<String> strategies = lab.strategies().stream().map(item -> Json.object(
                    Json.field("id", item.id()), Json.field("label", item.label()),
                    Json.field("formula", item.formula()), Json.field("how", item.how()),
                    Json.field("why", item.why()), Json.bool("keyed", item.keyed()),
                    Json.bool("active", item.active()))).toList();

            List<String> traces = lab.trace().stream().map(entry -> Json.object(
                    Json.number("sequence", entry.sequence()), Json.field("key", entry.key()),
                    Json.field("node", entry.node()), Json.field("reason", entry.reason()),
                    Json.decimal("latencyMs", entry.latencyMs()), Json.field("transport", entry.transport()),
                    Json.field("status", entry.status()))).toList();

            return Json.object(
                    Json.field("strategy", lab.strategy()), Json.field("strategyLabel", lab.strategyLabel()),
                    Json.field("formula", lab.formula()), Json.field("how", lab.how()), Json.field("why", lab.why()),
                    Json.number("requests", lab.requests()), Json.number("concurrency", lab.concurrency()),
                    Json.field("skew", lab.skew()), Json.field("skewLabel", lab.skewLabel()),
                    Json.bool("busy", lab.busy()), Json.field("lastAction", lab.lastAction()),
                    Json.field("dataSource", PharmacyData.describeSource()),
                    Json.field("updatedAt", Instant.now().toString()),
                    Json.raw("backends", Json.array(backends)),
                    Json.raw("strategies", Json.array(strategies)),
                    Json.raw("lastRun", runJson(lab.lastRun())),
                    Json.raw("history", Json.array(lab.history().stream().map(PharmacyWebServer.ApiService::runJson).toList())),
                    Json.raw("comparison", Json.array(lab.comparison().stream().map(PharmacyWebServer.ApiService::runJson).toList())),
                    Json.raw("trace", Json.array(traces)));
        }

        private static String runJson(LoadBalancerLab.RunSummary run) {
            if (run == null) return "null";
            List<String> shares = run.shares().stream().map(share -> Json.object(
                    Json.field("node", share.node()), Json.field("branchCode", share.branchCode()),
                    Json.number("dispatched", share.dispatched()), Json.number("completed", share.completed()),
                    Json.number("failed", share.failed()), Json.decimal("sharePercent", share.sharePercent()),
                    Json.decimal("ewmaMs", share.ewmaMs()))).toList();
            return Json.object(
                    Json.number("run", run.run()), Json.field("strategy", run.strategy()),
                    Json.field("strategyLabel", run.strategyLabel()), Json.number("requests", run.requests()),
                    Json.number("concurrency", run.concurrency()), Json.field("skew", run.skew()),
                    Json.decimal("durationMs", run.durationMs()), Json.decimal("throughput", run.throughput()),
                    Json.decimal("p50Ms", run.p50Ms()), Json.decimal("p95Ms", run.p95Ms()),
                    Json.decimal("p99Ms", run.p99Ms()), Json.decimal("meanMs", run.meanMs()),
                    Json.number("errors", run.errors()), Json.number("rejected", run.rejected()),
                    Json.decimal("fairness", run.fairness()), Json.decimal("spreadPercent", run.spreadPercent()),
                    Json.raw("shares", Json.array(shares)));
        }

        private String handleFaultToleranceAction(String action) {
            return faultToleranceJson(faultTolerance.apply(action));
        }

        private String faultToleranceJson() {
            return faultToleranceJson(faultTolerance.snapshot());
        }

        private static String faultToleranceJson(PrimaryBackupSimulation.Snapshot simulation) {
            List<String> nodes = simulation.nodes().stream().map(node -> Json.object(
                    Json.field("name", node.name()),
                    Json.field("branchCode", node.branchCode()),
                    Json.number("port", node.port()),
                    Json.field("configuredRole", node.configuredRole()),
                    Json.field("role", node.role()),
                    Json.field("state", node.state()),
                    Json.bool("available", node.available()),
                    Json.bool("caughtUp", node.caughtUp()))).toList();
            List<String> events = simulation.events().stream().map(event -> Json.object(
                    Json.number("sequence", event.sequence()),
                    Json.field("key", event.key()),
                    Json.field("payload", event.payload()),
                    Json.field("commitState", event.commitState()),
                    Json.bool("primaryAck", event.primaryAck()),
                    Json.bool("backupAck", event.backupAck()),
                    Json.field("committedBy", event.committedBy()),
                    Json.number("term", event.term()),
                    Json.bool("replayed", event.replayed()))).toList();
            List<String> audit = simulation.audit().stream().map(entry -> Json.object(
                    Json.field("occurredAt", entry.occurredAt()),
                    Json.field("type", entry.type()),
                    Json.field("message", entry.message()),
                    Json.number("term", entry.term()))).toList();
            return Json.object(
                    Json.field("phase", simulation.phase()),
                    Json.field("mode", simulation.mode()),
                    Json.field("activeNode", simulation.activeNode()),
                    Json.field("configuredPrimary", simulation.configuredPrimary()),
                    Json.field("configuredBackup", simulation.configuredBackup()),
                    Json.number("term", simulation.term()),
                    Json.number("failoverCount", simulation.failoverCount()),
                    Json.number("replayCount", simulation.replayCount()),
                    Json.number("committedEvents", simulation.committedEvents()),
                    Json.number("replicatedEvents", simulation.replicatedEvents()),
                    Json.number("replicationLag", simulation.replicationLag()),
                    Json.bool("primaryAvailable", simulation.primaryAvailable()),
                    Json.bool("backupAvailable", simulation.backupAvailable()),
                    Json.field("lastAction", simulation.lastAction()),
                    Json.field("updatedAt", simulation.updatedAt()),
                    Json.raw("nodes", Json.array(nodes)),
                    Json.raw("events", Json.array(events)),
                    Json.raw("audit", Json.array(audit)),
                    Json.raw("controls", Json.object(
                            Json.bool("canAppend", simulation.primaryAvailable() || simulation.backupAvailable()),
                            Json.bool("canFailPrimary", simulation.primaryAvailable()),
                            Json.bool("canRecoverPrimary", !simulation.primaryAvailable()),
                            Json.bool("canReset", true))));
        }

        private String healthJson() {
            List<NodeView> nodes = nodeViews();
            long reachable = nodes.stream().filter(NodeView::reachable).count();
            return Json.object(
                    Json.field("status", "ok"),
                    Json.field("gateway", "ready"),
                    Json.field("dataSource", "PostgreSQL (" + PharmacyData.describeSource() + ")"),
                    Json.bool("rmiRouterReachable", reachable > 0 && routerAvailable()),
                    Json.field("checkedAt", Instant.now().toString()));
        }

        private String overviewJson() {
            List<NodeView> nodes = nodeViews();
            long totalUnits = PharmacyData.inventory().stream().mapToLong(Inventory::quantity).sum();
            long lowStock = PharmacyData.inventory().stream()
                    .filter(row -> row.quantity() <= row.reorderThreshold()).count();
            long pendingSync = PharmacyData.inventory().stream()
                    .filter(row -> !"SYNCED".equals(row.syncStatus())).count();
            long controlled = PharmacyData.medicines().stream().filter(Medicine::controlled).count();
            long reachable = nodes.stream().filter(NodeView::reachable).count();
            Map<String, Long> branchStatuses = countBy(PharmacyData.branches().stream().map(PharmacyBranch::status).toList());
            Map<String, Long> transactionStatuses = countBy(PharmacyData.transactions().stream().map(DispensingTransaction::syncStatus).toList());

            return Json.object(
                    Json.field("generatedAt", Instant.now().toString()),
                    Json.field("source", "PostgreSQL + live RMI registry probes"),
                    Json.raw("counts", Json.object(
                            Json.number("branches", PharmacyData.branches().size()),
                            Json.number("medicines", PharmacyData.medicines().size()),
                            Json.number("prescriptions", PharmacyData.prescriptions().size()),
                            Json.number("inventoryRows", PharmacyData.inventory().size()),
                            Json.number("transactions", PharmacyData.transactions().size()),
                            Json.number("controlledMedicines", controlled))),
                    Json.raw("inventory", Json.object(
                            Json.number("totalUnits", totalUnits),
                            Json.number("lowStockRows", lowStock),
                            Json.number("rowsNeedingSync", pendingSync))),
                    Json.raw("branchStatuses", Json.objectFromCounts(branchStatuses)),
                    Json.raw("transactionStatuses", Json.objectFromCounts(transactionStatuses)),
                    Json.raw("network", networkSummary(nodes)));
        }

        private String networkJson() {
            List<NodeView> nodes = nodeViews();
            List<String> serialized = new ArrayList<>();
            for (NodeView node : nodes) {
                serialized.add(Json.object(
                        Json.number("nodeId", node.definition().id()),
                        Json.field("name", node.definition().name()),
                        Json.number("port", node.definition().port()),
                        Json.field("branchCode", node.definition().branchCode()),
                        Json.field("branchName", node.branch().name()),
                        Json.field("city", node.branch().city()),
                        Json.field("declaredStatus", node.branch().status()),
                        Json.field("effectiveStatus", node.effectiveStatus()),
                        Json.bool("reachable", node.reachable()),
                        Json.bool("coordinator", node.coordinator())));
            }
            return Json.object(
                    Json.field("mode", nodes.stream().anyMatch(NodeView::reachable) ? "rmi-live" : "catalog-only"),
                    Json.field("coordinator", coordinator(nodes)),
                    Json.number("reachableNodes", nodes.stream().filter(NodeView::reachable).count()),
                    Json.number("totalNodes", nodes.size()),
                    Json.raw("nodes", Json.array(serialized)),
                    Json.field("checkedAt", Instant.now().toString()));
        }

        private String branchesJson() {
            List<String> rows = new ArrayList<>();
            for (NodeView node : nodeViews()) {
                rows.add(Json.object(
                        Json.field("id", node.branch().id()),
                        Json.field("code", node.branch().code()),
                        Json.field("name", node.branch().name()),
                        Json.field("city", node.branch().city()),
                        Json.field("state", node.branch().state()),
                        Json.field("declaredStatus", node.branch().status()),
                        Json.field("effectiveStatus", node.effectiveStatus()),
                        Json.number("nodeId", node.definition().id()),
                        Json.number("port", node.definition().port()),
                        Json.bool("reachable", node.reachable())));
            }
            return Json.object(Json.raw("items", Json.array(rows)), Json.number("total", rows.size()));
        }

        private String medicinesJson() {
            List<String> rows = new ArrayList<>();
            for (Medicine medicine : PharmacyData.medicines()) {
                int stock = PharmacyData.inventory().stream()
                        .filter(row -> row.medicineId().equals(medicine.id()))
                        .mapToInt(Inventory::quantity).sum();
                long branches = PharmacyData.inventory().stream()
                        .filter(row -> row.medicineId().equals(medicine.id())).map(Inventory::branchId).distinct().count();
                rows.add(Json.object(
                        Json.field("id", medicine.id()), Json.field("code", medicine.code()),
                        Json.field("name", medicine.name()), Json.field("genericName", medicine.genericName()),
                        Json.field("category", medicine.category()), Json.bool("controlled", medicine.controlled()),
                        Json.field("scheduleClass", medicine.scheduleClass()), Json.field("unit", medicine.unit()),
                        Json.field("manufacturer", medicine.manufacturer()), Json.number("stockUnits", stock),
                        Json.number("branchCount", branches)));
            }
            return Json.object(Json.raw("items", Json.array(rows)), Json.number("total", rows.size()));
        }

        private String prescriptionsJson() {
            List<String> rows = new ArrayList<>();
            for (Prescription prescription : PharmacyData.prescriptions()) {
                Medicine medicine = PharmacyData.medicineById(prescription.medicineId());
                PharmacyBranch branch = PharmacyData.branchById(prescription.branchId());
                rows.add(Json.object(
                        Json.field("id", prescription.id()), Json.field("hash", prescription.hash()),
                        Json.field("patientName", prescription.patientName()), Json.field("patientId", prescription.patientId()),
                        Json.field("doctorName", prescription.doctorName()), Json.field("doctorLicense", prescription.doctorLicense()),
                        Json.field("branchCode", branch == null ? prescription.branchId() : branch.code()),
                        Json.field("branchCity", branch == null ? "Unknown" : branch.city()),
                        Json.field("medicineCode", medicine == null ? prescription.medicineId() : medicine.code()),
                        Json.field("medicineName", medicine == null ? "Unknown medicine" : medicine.name()),
                        Json.number("quantity", prescription.quantity()), Json.field("dosage", prescription.dosage()),
                        Json.field("issueDate", prescription.issueDate()), Json.field("expiryDate", prescription.expiryDate()),
                        Json.field("status", prescription.status())));
            }
            return Json.object(Json.raw("items", Json.array(rows)), Json.number("total", rows.size()));
        }

        private String inventoryJson() {
            List<String> rows = new ArrayList<>();
            for (Inventory inventory : PharmacyData.inventory()) {
                PharmacyBranch branch = PharmacyData.branchById(inventory.branchId());
                Medicine medicine = PharmacyData.medicineById(inventory.medicineId());
                rows.add(Json.object(
                        Json.field("id", inventory.id()), Json.field("branchCode", branch == null ? inventory.branchId() : branch.code()),
                        Json.field("branchCity", branch == null ? "Unknown" : branch.city()),
                        Json.field("medicineCode", medicine == null ? inventory.medicineId() : medicine.code()),
                        Json.field("medicineName", medicine == null ? "Unknown medicine" : medicine.name()),
                        Json.number("quantity", inventory.quantity()), Json.number("reorderThreshold", inventory.reorderThreshold()),
                        Json.raw("vectorClock", inventory.vectorClock()), Json.field("syncStatus", inventory.syncStatus()),
                        Json.field("stockState", inventory.quantity() <= inventory.reorderThreshold() ? "LOW" : "HEALTHY")));
            }
            return Json.object(Json.raw("items", Json.array(rows)), Json.number("total", rows.size()));
        }

        private String transactionsJson() {
            List<String> rows = new ArrayList<>();
            for (DispensingTransaction transaction : PharmacyData.transactions()) {
                PharmacyBranch branch = PharmacyData.branchById(transaction.branchId());
                Prescription prescription = PharmacyData.prescriptions().stream()
                        .filter(row -> row.id().equals(transaction.prescriptionId())).findFirst().orElse(null);
                rows.add(Json.object(
                        Json.field("id", transaction.id()), Json.field("prescriptionId", transaction.prescriptionId()),
                        Json.field("branchCode", branch == null ? transaction.branchId() : branch.code()),
                        Json.field("branchCity", branch == null ? "Unknown" : branch.city()),
                        Json.field("patientName", prescription == null ? "Unknown patient" : prescription.patientName()),
                        Json.field("pharmacist", transaction.pharmacist()), Json.field("license", transaction.license()),
                        Json.number("quantity", transaction.quantity()), Json.field("idempotencyKey", transaction.idempotencyKey()),
                        Json.field("dispensedAt", transaction.dispensedAt()), Json.field("syncStatus", transaction.syncStatus())));
            }
            return Json.object(Json.raw("items", Json.array(rows)), Json.number("total", rows.size()));
        }

        private String databaseJson() {
            List<String> tables = List.of(
                    Json.object(Json.field("name", "pharmacy_branches"), Json.number("rows", PharmacyData.branches().size()), Json.field("role", "Distributed node registry"), Json.field("consistency", "Registry + heartbeat"), Json.field("keyFields", "branch_id, branch_code, node_status")),
                    Json.object(Json.field("name", "medicines"), Json.number("rows", PharmacyData.medicines().size()), Json.field("role", "Shared read-mostly catalogue"), Json.field("consistency", "Logical replication"), Json.field("keyFields", "medicine_id, medicine_code, controlled flag")),
                    Json.object(Json.field("name", "prescriptions"), Json.number("rows", PharmacyData.prescriptions().size()), Json.field("role", "Tamper-evident clinical instructions"), Json.field("consistency", "Optimistic versioning"), Json.field("keyFields", "prescription_id, hash, version, status")),
                    Json.object(Json.field("name", "branch_inventory"), Json.number("rows", PharmacyData.inventory().size()), Json.field("role", "Branch-local stock view"), Json.field("consistency", "Vector clock + eventual sync"), Json.field("keyFields", "branch_id, medicine_id, sync_status")),
                    Json.object(Json.field("name", "dispensing_transactions"), Json.number("rows", PharmacyData.transactions().size()), Json.field("role", "Exactly-once dispensing ledger"), Json.field("consistency", "Idempotent replication"), Json.field("keyFields", "transaction_id, prescription_id, idempotency_key")));
            return Json.object(
                    Json.field("engine", "PostgreSQL · " + PharmacyData.describeSource()),
                    Json.field("referenceSchema", "sql/pharmacy_schema.sql"),
                    Json.field("note", "Live: every node and this gateway read these tables over JDBC (2 s cache). Edit rows with SQL and refresh."),
                    Json.raw("tables", Json.array(tables)));
        }

        private String searchJson(String rawType, String query) {
            SearchType type;
            try {
                type = SearchType.valueOf(rawType.toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException error) {
                type = SearchType.ANY;
            }
            String normalized = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
            List<SearchRecord> records = localSearch(type, normalized);
            String rmi = routedSearch(type, query == null ? "" : query.trim());
            return Json.object(
                    Json.field("query", query == null ? "" : query.trim()), Json.field("type", type.name()),
                    Json.number("total", records.size()), Json.raw("records", Json.array(records.stream().map(SearchRecord::json).toList())),
                    Json.raw("rmi", rmi));
        }

        private List<SearchRecord> localSearch(SearchType type, String query) {
            if (query.isBlank()) return List.of();
            List<SearchRecord> records = new ArrayList<>();
            Set<String> seen = new LinkedHashSet<>();
            for (Medicine medicine : PharmacyData.medicines()) {
                boolean medicineMatch = contains(query, medicine.code(), medicine.name(), medicine.genericName(), medicine.category());
                if ((type == SearchType.MEDICINE || type == SearchType.ANY) && medicineMatch) {
                    add(records, seen, SearchRecord.medicine(medicine));
                }
                if ((type == SearchType.MEDICINE || type == SearchType.ANY) && medicineMatch) {
                    for (Inventory inventory : PharmacyData.inventory()) {
                        if (inventory.medicineId().equals(medicine.id())) add(records, seen, SearchRecord.inventory(inventory));
                    }
                    for (Prescription prescription : PharmacyData.prescriptions()) {
                        if (prescription.medicineId().equals(medicine.id())) add(records, seen, SearchRecord.prescription(prescription));
                    }
                }
            }
            for (Prescription prescription : PharmacyData.prescriptions()) {
                boolean direct = contains(query, prescription.id(), prescription.hash(), prescription.patientId(), prescription.patientName(), prescription.doctorName());
                if ((type == SearchType.PRESCRIPTION || type == SearchType.ANY) && direct) add(records, seen, SearchRecord.prescription(prescription));
                if (type == SearchType.PATIENT && contains(query, prescription.patientId(), prescription.patientName())) add(records, seen, SearchRecord.prescription(prescription));
                if (type == SearchType.PRESCRIPTION && direct) {
                    for (DispensingTransaction transaction : PharmacyData.transactions()) {
                        if (transaction.prescriptionId().equals(prescription.id())) add(records, seen, SearchRecord.transaction(transaction));
                    }
                }
            }
            for (Inventory inventory : PharmacyData.inventory()) {
                Medicine medicine = PharmacyData.medicineById(inventory.medicineId());
                boolean match = contains(query, inventory.id(), inventory.branchId(), medicine == null ? "" : medicine.code(), medicine == null ? "" : medicine.name());
                if ((type == SearchType.INVENTORY || type == SearchType.ANY) && match) add(records, seen, SearchRecord.inventory(inventory));
            }
            for (DispensingTransaction transaction : PharmacyData.transactions()) {
                boolean match = contains(query, transaction.id(), transaction.prescriptionId(), transaction.idempotencyKey(), transaction.pharmacist());
                if ((type == SearchType.TRANSACTION || type == SearchType.ANY) && match) add(records, seen, SearchRecord.transaction(transaction));
                if (type == SearchType.PRESCRIPTION && match) add(records, seen, SearchRecord.transaction(transaction));
            }
            return records;
        }

        private String routedSearch(SearchType type, String query) {
            if (query.isBlank()) {
                return Json.object(Json.bool("connected", false), Json.field("mode", "idle"), Json.field("message", "Enter a query to route it through the cluster."));
            }
            try {
                PharmacyRouter router = (PharmacyRouter) LocateRegistry.getRegistry("127.0.0.1", 1099).lookup("PharmacyRouter");
                SearchResponse response = router.search(new SearchRequest(type, query, 1L));
                List<String> nodes = new ArrayList<>();
                for (NodeSearchResult result : response.getNodeResults()) {
                    nodes.add(Json.object(Json.field("name", result.getServerName()), Json.number("matches", result.getMatches().size()), Json.number("lamportTimestamp", result.getLamportTimestamp()), Json.raw("sample", Json.stringArray(result.getMatches().stream().limit(3).toList()))));
                }
                return Json.object(Json.bool("connected", true), Json.field("mode", "rmi-router"), Json.number("lamportTimestamp", response.getLamportTimestamp()), Json.raw("nodes", Json.array(nodes)));
            } catch (Exception error) {
                return Json.object(Json.bool("connected", false), Json.field("mode", "local-catalog"), Json.field("message", "RMI router unavailable; showing the same dataset locally."));
            }
        }

        private static void add(List<SearchRecord> records, Set<String> seen, SearchRecord record) {
            if (seen.add(record.kind() + ":" + record.id())) records.add(record);
        }

        private static boolean contains(String query, String... values) {
            for (String value : values) if (value != null && value.toLowerCase(Locale.ROOT).contains(query)) return true;
            return false;
        }

        private static Map<String, Long> countBy(List<String> values) {
            Map<String, Long> counts = new LinkedHashMap<>();
            for (String value : values) counts.merge(value, 1L, Long::sum);
            return counts;
        }

        private List<NodeView> nodeViews() {
            List<NodeView> nodes = new ArrayList<>();
            int coordinatorId = -1;
            for (NodeDefinition definition : NODES) {
                PharmacyBranch branch = PharmacyData.branchByCode(definition.branchCode());
                boolean reachable = canConnect(definition.port());
                if (reachable) coordinatorId = Math.max(coordinatorId, definition.id());
                nodes.add(new NodeView(definition, branch, reachable, false));
            }
            List<NodeView> resolved = new ArrayList<>();
            for (NodeView node : nodes) resolved.add(new NodeView(node.definition(), node.branch(), node.reachable(), node.definition().id() == coordinatorId));
            return resolved;
        }

        private static String coordinator(List<NodeView> nodes) {
            return nodes.stream().filter(NodeView::coordinator).findFirst().map(node -> node.definition().name()).orElse(null);
        }

        private static String networkSummary(List<NodeView> nodes) {
            return Json.object(
                    Json.field("mode", nodes.stream().anyMatch(NodeView::reachable) ? "rmi-live" : "catalog-only"),
                    Json.field("coordinator", coordinator(nodes)),
                    Json.number("reachableNodes", nodes.stream().filter(NodeView::reachable).count()),
                    Json.number("totalNodes", nodes.size()));
        }

        private static boolean routerAvailable() {
            try {
                LocateRegistry.getRegistry("127.0.0.1", 1099).lookup("PharmacyRouter");
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        private static boolean canConnect(int port) {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", port), 150);
                return true;
            } catch (IOException error) {
                return false;
            }
        }
    }

    /** RMI topology (node id = bully priority, port, served branch code). Branch rows come from PostgreSQL. */
    private record NodeDefinition(int id, String name, int port, String branchCode) {}

    private record NodeView(NodeDefinition definition, PharmacyBranch branch, boolean reachable, boolean coordinator) {
        private String effectiveStatus() {
            if (!reachable) return "OFFLINE";
            return branch.status();
        }
    }

    private record SearchRecord(String kind, String id, String title, String subtitle, String status, String location) {
        private String json() {
            return Json.object(Json.field("kind", kind), Json.field("id", id), Json.field("title", title), Json.field("subtitle", subtitle), Json.field("status", status), Json.field("location", location));
        }

        private static SearchRecord medicine(Medicine medicine) {
            return new SearchRecord("MEDICINE", medicine.id(), medicine.code() + " / " + medicine.name(), medicine.genericName() + " · " + medicine.category(), medicine.controlled() ? medicine.scheduleClass() : "STANDARD", "Shared catalogue");
        }

        private static SearchRecord prescription(Prescription prescription) {
            PharmacyBranch branch = PharmacyData.branchById(prescription.branchId());
            Medicine medicine = PharmacyData.medicineById(prescription.medicineId());
            return new SearchRecord("PRESCRIPTION", prescription.id(), prescription.patientName(), (medicine == null ? "Unknown medicine" : medicine.name()) + " · " + prescription.doctorName(), prescription.status(), branch == null ? "Unknown branch" : branch.code());
        }

        private static SearchRecord inventory(Inventory inventory) {
            PharmacyBranch branch = PharmacyData.branchById(inventory.branchId());
            Medicine medicine = PharmacyData.medicineById(inventory.medicineId());
            return new SearchRecord("INVENTORY", inventory.id(), medicine == null ? inventory.medicineId() : medicine.name(), inventory.quantity() + " units · reorder at " + inventory.reorderThreshold(), inventory.syncStatus(), branch == null ? "Unknown branch" : branch.code());
        }

        private static SearchRecord transaction(DispensingTransaction transaction) {
            PharmacyBranch branch = PharmacyData.branchById(transaction.branchId());
            return new SearchRecord("TRANSACTION", transaction.id(), transaction.idempotencyKey(), transaction.pharmacist() + " · " + transaction.quantity() + " units", transaction.syncStatus(), branch == null ? "Unknown branch" : branch.code());
        }
    }

    private static final class Json {
        private Json() {}

        private static String object(String... fields) {
            return "{" + String.join(",", fields) + "}";
        }

        private static String array(List<String> values) {
            return "[" + String.join(",", values) + "]";
        }

        private static String stringArray(List<String> values) {
            return array(values.stream().map(Json::value).toList());
        }

        private static String field(String name, String value) {
            return value(name) + ":" + value(value);
        }

        private static String number(String name, long value) {
            return value(name) + ":" + value;
        }

        private static String decimal(String name, double value) {
            if (Double.isNaN(value) || Double.isInfinite(value)) return value(name) + ":0";
            return value(name) + ":" + (Math.round(value * 100.0) / 100.0);
        }

        private static String bool(String name, boolean value) {
            return value(name) + ":" + value;
        }

        private static String raw(String name, String value) {
            return value(name) + ":" + (value == null || value.isBlank() ? "{}" : value);
        }

        private static String value(Object value) {
            if (value == null) return "null";
            if (value instanceof Number || value instanceof Boolean) return value.toString();
            String input = String.valueOf(value);
            StringBuilder escaped = new StringBuilder(input.length() + 2).append('"');
            for (int index = 0; index < input.length(); index++) {
                char character = input.charAt(index);
                switch (character) {
                    case '\\' -> escaped.append("\\\\");
                    case '"' -> escaped.append("\\\"");
                    case '\n' -> escaped.append("\\n");
                    case '\r' -> escaped.append("\\r");
                    case '\t' -> escaped.append("\\t");
                    default -> escaped.append(character);
                }
            }
            return escaped.append('"').toString();
        }

        private static String objectFromCounts(Map<String, Long> counts) {
            List<String> fields = new ArrayList<>();
            for (Map.Entry<String, Long> entry : counts.entrySet()) fields.add(number(entry.getKey(), entry.getValue()));
            return object(fields.toArray(String[]::new));
        }
    }
}
