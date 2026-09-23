package com.pharmacy.rmi.server;

import com.pharmacy.rmi.model.*;
import com.pharmacy.rmi.clock.LamportClock;
import com.pharmacy.rmi.election.BullyElection;
import com.pharmacy.rmi.util.Console;
import java.rmi.server.UnicastRemoteObject;
import java.rmi.registry.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.rmi.RemoteException;

public class PharmacyRouterImpl extends UnicastRemoteObject implements PharmacyRouter {
    private final Map<String,Integer> ports = new LinkedHashMap<>();
    private final Map<String,PharmacyNode> cache = new ConcurrentHashMap<>();
    private final LamportClock clock = new LamportClock();
    private final BullyElection bully;

    private static final List<BullyElection.PharmacyProcess> CLUSTER = List.of(
            new BullyElection.PharmacyProcess(1, "Mumbai", 1099),
            new BullyElection.PharmacyProcess(2, "Pune", 1100),
            new BullyElection.PharmacyProcess(3, "Bengaluru", 1101),
            new BullyElection.PharmacyProcess(4, "Delhi", 1102),
            new BullyElection.PharmacyProcess(5, "Hyderabad", 1103),
            new BullyElection.PharmacyProcess(6, "Chennai", 1104));

    {
        for (BullyElection.PharmacyProcess process : CLUSTER) ports.put(process.name(), process.port());
    }

    public PharmacyRouterImpl() throws RemoteException {
        super();
        bully = new BullyElection(CLUSTER);
    }

    public SearchResponse search(SearchRequest request) {
        // Lamport rule 3: message received from client -> C = max(C, T) + 1
        long syncedTs = clock.sync(request.getLamportTimestamp());
        Console.section("ROUTER: NEW SEARCH REQUEST");
        Console.tag(Console.BLUE, "Router", "type=" + request.getType() + "  query=\"" + request.getQuery() + "\"  "
                + Console.lamportRecv(request.getLamportTimestamp(), syncedTs));

        ensureElection("router startup / request received");
        Console.tag(Console.GREEN, "Router", "Coordinator Node " + bully.getCoordinatorId()
                + " (" + bully.getCoordinatorName() + ") is coordinating the six-node search.");
        List<NodeSearchResult> results=new ArrayList<>();
        for (var entry: ports.entrySet()) {
            try {
                PharmacyNode node=cache.computeIfAbsent(entry.getKey(), k -> lookup(k,entry.getValue()));
                // Lamport rule 1/2: about to send a message to a node -> increment, attach timestamp
                long outTs = clock.tick();
                SearchRequest forwarded = new SearchRequest(request.getType(), request.getQuery(), outTs);
                NodeSearchResult r=node.search(forwarded);
                // Lamport rule 3: message received back from node -> C = max(C, T) + 1
                long recvTs = clock.sync(r.getLamportTimestamp());
                String matchLabel = r.getMatches().size() + " match" + (r.getMatches().size()==1?"":"es");
                Console.tag(Console.BLUE, "Router", String.format("%-10s -> %-10s  %s",
                        entry.getKey(), matchLabel, Console.lamportRoundTrip(outTs, r.getLamportTimestamp(), recvTs)));
                results.add(r);
            } catch (Exception ex) {
                Console.tag(Console.RED, "Router", entry.getKey() + " UNAVAILABLE -> " + rootMessage(ex));
                handleFailure(entry.getKey());
            }
        }
        // Lamport rule 1/2: about to reply to the client -> increment, attach timestamp
        long replyTs = clock.tick();
        Console.tag(Console.BLUE, "Router", "replying to client  " + Console.lamportSend(replyTs));
        return new SearchResponse(request,results,replyTs);
    }

    private synchronized void ensureElection(String reason) {
        if (bully.getCoordinatorId() != -1) return;
        Console.tag(Console.YELLOW, "Router",
                "No coordinator available; starting Bully election because " + reason);
        int initiator = ports.keySet().stream()
                .mapToInt(name -> CLUSTER.stream().filter(p -> p.name().equals(name)).findFirst().orElseThrow().id())
                .filter(id -> bully.isAlive(id))
                .findFirst().orElseThrow(() -> new IllegalStateException("No pharmacy server is alive"));
        bully.startElection(initiator);
        Console.tag(Console.GREEN, "Router", "Coordinator ready: Node " + bully.getCoordinatorId()
                + " (" + bully.getCoordinatorName() + ") will coordinate this client request.");
    }

    private synchronized void handleFailure(String failedName) {
        int failedId = CLUSTER.stream().filter(p -> p.name().equals(failedName))
                .findFirst().orElseThrow().id();
        if (!bully.isAlive(failedId)) return;
        bully.failNode(failedId);
        cache.remove(failedName);
        Console.tag(Console.YELLOW, "Router",
                "Failure detector observed " + failedName + "; restarting Bully election before continuing request.");
        runElection("failure of " + failedName);
    }

    private void runElection(String reason) {
        Console.tag(Console.YELLOW, "Router", "Bully election trigger: " + reason);
        int initiator = CLUSTER.stream()
                .filter(p -> bully.isAlive(p.id()))
                .mapToInt(BullyElection.PharmacyProcess::id)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("No pharmacy server is alive"));
        bully.startElection(initiator);
        Console.tag(Console.GREEN, "Router", "Coordinator ready: Node " + bully.getCoordinatorId()
                + " (" + bully.getCoordinatorName() + ") will coordinate this client request.");
    }

    private String rootMessage(Exception ex) {
        Throwable current = ex;
        while (current.getCause() != null) current = current.getCause();
        return current.getMessage() == null ? current.getClass().getSimpleName() : current.getMessage();
    }
    private PharmacyNode lookup(String name,int port) {
        try { return (PharmacyNode) LocateRegistry.getRegistry("localhost",port).lookup("PharmacyNode"); }
        catch(Exception e){ throw new RuntimeException("RMI lookup failed",e); }
    }
}
