package com.pharmacy.rmi.server;

import com.pharmacy.rmi.util.Console;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.util.Set;
import java.util.concurrent.CountDownLatch;

/** Starts one physical pharmacy node. The router's Bully cluster uses the same node IDs/ports. */
public final class BranchServer {
    private BranchServer() {}

    public static void start(String name, int port, String branchCode) throws Exception {
        Registry registry = LocateRegistry.createRegistry(port);
        registry.rebind("PharmacyNode", new PharmacyNodeImpl(name, Set.of(branchCode)));
        Console.banner(Console.GREEN, name.toUpperCase() + " SERVER  |  PharmacyNode",
                "Node ID   : " + nodeId(name),
                "Port      : " + port,
                "Bindings  : PharmacyNode",
                "Branches  : " + branchCode,
                "Bully     : participates in six-node election cluster",
                "Data      : PostgreSQL (" + PharmacyData.describeSource() + ")",
                "Status    : " + Console.GREEN + "READY - waiting for requests" + Console.RESET);
        new CountDownLatch(1).await();
    }

    private static int nodeId(String name) {
        return switch (name) {
            case "Mumbai" -> 1; case "Pune" -> 2; case "Bengaluru" -> 3;
            case "Delhi" -> 4; case "Hyderabad" -> 5; case "Chennai" -> 6;
            default -> throw new IllegalArgumentException("Unknown node: " + name);
        };
    }
}
