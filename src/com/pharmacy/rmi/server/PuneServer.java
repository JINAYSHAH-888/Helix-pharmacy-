package com.pharmacy.rmi.server;

import com.pharmacy.rmi.util.Console;
import java.rmi.registry.*;
import java.util.Set;

public class PuneServer {
    public static void main(String[] args) throws Exception {
        Registry registry = LocateRegistry.createRegistry(1100);
        Set<String> branches = Set.of("BR-PUN-06");   // branch code; UUID resolved from PostgreSQL
        registry.rebind("PharmacyNode", new PharmacyNodeImpl("Pune", branches));

        Console.banner(Console.YELLOW, "PUNE SERVER  |  PharmacyNode",
                "Port      : 1100",
                "Bindings  : PharmacyNode",
                "Branches  : BR-HYD-04, BR-PUN-06",
                "Data      : PostgreSQL (" + PharmacyData.describeSource() + ")",
                "Status    : " + Console.GREEN + "READY - waiting for requests" + Console.RESET
        );

        new java.util.concurrent.CountDownLatch(1).await();
    }
}
