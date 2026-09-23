package com.pharmacy.rmi.election;

import com.pharmacy.rmi.util.Console;

import java.util.List;

/**
 * Terminal demonstration of the Bully election algorithm using the existing
 * pharmacy nodes from the RMI project.
 */
public final class BullyElectionDemo {
    private BullyElectionDemo() {}

    public static void main(String[] args) {
        Console.banner(Console.GREEN,
                "DISTRIBUTED PHARMACY — BULLY ELECTION",
                "Election algorithm : Bully",
                "Nodes               : Mumbai, Pune, Bengaluru, Delhi, Hyderabad, Chennai",
                "Priority rule       : highest node ID becomes coordinator",
                "Clock instrumentation: existing LamportClock",
                "RMI ports            : 1099 / 1100 / 1101 / 1102 / 1103 / 1104");

        BullyElection bully = new BullyElection(List.of(
                new BullyElection.PharmacyProcess(1, "Mumbai", 1099),
                new BullyElection.PharmacyProcess(2, "Pune", 1100),
                new BullyElection.PharmacyProcess(3, "Bengaluru", 1101),
                new BullyElection.PharmacyProcess(4, "Delhi", 1102),
                new BullyElection.PharmacyProcess(5, "Hyderabad", 1103),
                new BullyElection.PharmacyProcess(6, "Chennai", 1104)
        ));

        Console.section("INITIAL CLUSTER");
        bully.printStatus();

        Console.tag(Console.GREEN, "System", "Initial election: Mumbai (Node 1) detects no known coordinator.");
        int initialLeader = bully.startElection(1);
        printLeader(bully, initialLeader);

        Console.section("COORDINATOR FAILURE SCENARIO");
        Console.tag(Console.RED, "System", "Simulating failure of the current coordinator: Chennai (Node 6)");
        bully.failNode(6);
        bully.printStatus();

        Console.tag(Console.YELLOW, "System", "Pune (Node 2) detects coordinator failure and starts a new election.");
        int secondLeader = bully.startElection(2);
        printLeader(bully, secondLeader);

        Console.section("COORDINATOR RECOVERY + BULLY RE-ELECTION");
        Console.tag(Console.GREEN, "System", "Chennai (Node 6) recovers and starts an election after rejoining.");
        bully.recoverNode(6);
        bully.printStatus();

        int recoveredLeader = bully.startElection(6);
        printLeader(bully, recoveredLeader);

        Console.section("FINAL CLUSTER STATE");
        bully.printStatus();
        Console.tag(Console.GREEN, "System",
                "Bully algorithm demo completed successfully. Existing pharmacy services were not modified.");
    }

    private static void printLeader(BullyElection bully, int leaderId) {
        Console.tag(Console.GREEN, "Leader",
                "Node " + leaderId + " (" + bully.getCoordinatorName() + ") is the current coordinator.");
        System.out.println();
    }
}
