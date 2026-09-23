package com.pharmacy.rmi.server;

import com.pharmacy.rmi.util.Console;
import java.rmi.registry.*;
import java.util.Set;

public class BengaluruServer {
    public static void main(String[] args) throws Exception {
        Registry registry = LocateRegistry.createRegistry(1101);
        Set<String> branches = Set.of("a1000000-0000-0000-0000-000000000003");
        registry.rebind("PharmacyNode", new PharmacyNodeImpl("Bengaluru", branches));

        Console.banner(Console.MAGENTA, "BENGALURU SERVER  |  PharmacyNode",
                "Port      : 1101",
                "Bindings  : PharmacyNode",
                "Branches  : BR-BLR-03, BR-CHN-05",
                "Data      : hardcoded dataset loaded in memory",
                "Status    : " + Console.GREEN + "READY - waiting for requests" + Console.RESET
        );

        new java.util.concurrent.CountDownLatch(1).await();
    }
}
