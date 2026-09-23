package com.pharmacy.rmi.client;

import com.pharmacy.rmi.model.*;
import com.pharmacy.rmi.server.PharmacyRouter;
import com.pharmacy.rmi.clock.LamportClock;
import com.pharmacy.rmi.util.Console;

import java.rmi.registry.LocateRegistry;
import java.util.List;
import java.util.concurrent.*;

/**
 * Demonstrates multiple clients calling the same RMI router concurrently.
 * Each worker represents an independent client session.
 */
public class ConcurrentClientDemo {
    private record ClientJob(int clientId, SearchType type, String query) {}

    private static final String[] COLORS = {
            Console.CYAN, Console.MAGENTA, Console.YELLOW, Console.BLUE, Console.GREEN
    };

    public static void main(String[] args) throws Exception {
        int clientCount = 5;
        ExecutorService pool = Executors.newFixedThreadPool(clientCount);

        List<ClientJob> jobs = List.of(
                new ClientJob(1, SearchType.MEDICINE, "MED-0008"),
                new ClientJob(2, SearchType.MEDICINE, "Paracetamol"),
                new ClientJob(3, SearchType.PATIENT, "Rohan Mehta"),
                new ClientJob(4, SearchType.INVENTORY, "MED-0001"),
                new ClientJob(5, SearchType.TRANSACTION, "a5000000-0000-0000-0000-000000000002")
        );

        Console.banner(Console.GREEN, "CONCURRENT RMI CLIENT DEMO",
                "Clients : " + jobs.size() + " independent worker threads",
                "Route   : each client -> Mumbai Router -> six pharmacy nodes"
        );

        try {
            List<Future<?>> futures = new java.util.ArrayList<>();
            for (ClientJob job : jobs) {
                futures.add(pool.submit(() -> runClient(job)));
            }
            for (Future<?> future : futures) {
                future.get();
            }
        } finally {
            pool.shutdown();
            pool.awaitTermination(5, TimeUnit.SECONDS);
        }

        System.out.println("\n" + Console.BOLD + Console.GREEN
                + "All concurrent client requests completed." + Console.RESET);
    }

    private static void runClient(ClientJob job) {
        String color = COLORS[(job.clientId() - 1) % COLORS.length];
        String label = "CLIENT-" + job.clientId();
        // Each concurrent "client" is an independent process for Lamport-clock
        // purposes, so it gets its own clock instance.
        LamportClock clock = new LamportClock();
        try {
            PharmacyRouter router = (PharmacyRouter) LocateRegistry
                    .getRegistry("localhost", 1099)
                    .lookup("PharmacyRouter");

            Console.tag(color, label, "START    type=" + job.type() + "  query=\"" + job.query() + "\"");

            // Lamport rule 1/2: about to send a message -> increment, attach timestamp
            long sendTs = clock.tick();
            SearchResponse response = router.search(new SearchRequest(job.type(), job.query(), sendTs));
            // Lamport rule 3: message received back -> C = max(C, T) + 1
            long recvTs = clock.sync(response.getLamportTimestamp());
            Console.tag(color, label, Console.lamportRoundTrip(sendTs, response.getLamportTimestamp(), recvTs));

            int total = 0;
            for (NodeSearchResult result : response.getNodeResults()) {
                if (!result.hasMatches()) continue;
                total += result.getMatches().size();
                Console.tag(color, label, "SERVER=" + result.getServerName()
                        + "  matches=" + result.getMatches().size());
                for (String match : result.getMatches()) {
                    System.out.println("    " + match);
                }
            }

            Console.tag(color, label, "DONE     totalMatches=" + total);
        } catch (Exception e) {
            Console.tag(Console.RED, label, "ERROR  " + e.getMessage());
        }
    }
}
