package com.pharmacy.rmi.server;

import com.pharmacy.rmi.util.Console;
import java.rmi.registry.*;
import java.util.Set;

public class PuneServer {
    public static void main(String[] args) throws Exception {
        Registry registry = LocateRegistry.createRegistry(1100);
        Set<String> branches = Set.of("a1000000-0000-0000-0000-000000000006");
        registry.rebind("PharmacyNode", new PharmacyNodeImpl("Pune", branches));

        Console.banner(Console.YELLOW, "PUNE SERVER  |  PharmacyNode",
                "Port      : 1100",
                "Bindings  : PharmacyNode",
                "Branches  : BR-HYD-04, BR-PUN-06",
                "Data      : hardcoded dataset loaded in memory",
                "Status    : " + Console.GREEN + "READY - waiting for requests" + Console.RESET
        );

        new java.util.concurrent.CountDownLatch(1).await();
    }
}
