package com.pharmacy.rmi.server;

import com.pharmacy.rmi.util.Console;
import java.rmi.registry.*;
import java.util.Set;

public class MumbaiServer {
    public static void main(String[] args) throws Exception {
        Registry registry = LocateRegistry.createRegistry(1099);
        Set<String> branches = Set.of("BR-MUM-02");   // branch code; UUID resolved from PostgreSQL
        registry.rebind("PharmacyNode", new PharmacyNodeImpl("Mumbai", branches));
        registry.rebind("PharmacyRouter", new PharmacyRouterImpl());

        Console.banner(Console.CYAN, "MUMBAI SERVER  |  PharmacyNode + PharmacyRouter",
                "Port      : 1099",
                "Bindings  : PharmacyNode, PharmacyRouter",
                "Branches  : BR-DEL-01, BR-MUM-02",
                "Data      : PostgreSQL (" + PharmacyData.describeSource() + ")",
                "Status    : " + Console.GREEN + "READY - waiting for requests" + Console.RESET
        );

        new java.util.concurrent.CountDownLatch(1).await();
    }
}
