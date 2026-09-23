package com.pharmacy.rmi.client;

import com.pharmacy.rmi.model.*;
import com.pharmacy.rmi.server.PharmacyRouter;
import com.pharmacy.rmi.clock.LamportClock;
import com.pharmacy.rmi.util.Console;
import java.rmi.registry.*;
import java.util.Scanner;

public class Client {
    public static void main(String[] args) throws Exception {
        PharmacyRouter router=(PharmacyRouter) LocateRegistry.getRegistry("localhost",1099).lookup("PharmacyRouter");
        LamportClock clock = new LamportClock();
        Scanner sc=new Scanner(System.in);

        Console.banner(Console.GREEN, "DISTRIBUTED PHARMACY  |  RMI CLIENT",
                "Route : Client -> Mumbai Router -> six pharmacy nodes",
                "Sync  : Lamport logical clocks on every hop"
        );

        while(true){
            printMenu();
            System.out.print(Console.BOLD + "Choice: " + Console.RESET);
            String c=sc.nextLine().trim();
            if(c.equals("0")) break;
            SearchType type=switch(c){
                case "1" -> SearchType.MEDICINE;
                case "2" -> SearchType.PRESCRIPTION;
                case "3" -> SearchType.PATIENT;
                case "4" -> SearchType.INVENTORY;
                case "5" -> SearchType.TRANSACTION;
                case "6" -> SearchType.ANY;
                default -> null;
            };
            if(type==null){
                System.out.println(Console.RED + "Invalid choice. Please pick an option from the menu." + Console.RESET);
                continue;
            }
            System.out.print(Console.BOLD + "Search value: " + Console.RESET);
            String q=sc.nextLine().trim();

            // Lamport rule 1/2: about to send a message -> increment, attach timestamp
            long sendTs = clock.tick();
            SearchResponse response=router.search(new SearchRequest(type,q,sendTs));
            // Lamport rule 3: message received back -> C = max(C, T) + 1
            long recvTs = clock.sync(response.getLamportTimestamp());

            Console.section("SEARCH RESULT");
            System.out.println(Console.GRAY + "Query   : type=" + type + "  value=\"" + q + "\"" + Console.RESET);
            System.out.println(Console.lamportRoundTrip(sendTs, response.getLamportTimestamp(), recvTs));

            if(!response.found()){
                System.out.println("\n" + Console.YELLOW + "No matches found on the six pharmacy nodes." + Console.RESET);
            } else {
                int total=0;
                for(NodeSearchResult nr: response.getNodeResults()){
                    if(!nr.hasMatches()) continue;
                    System.out.println("\n" + Console.BOLD + Console.CYAN
                            + ">> " + nr.getServerName().toUpperCase() + " SERVER" + Console.RESET);
                    for(String line:nr.getMatches()){
                        System.out.println("  " + line);
                        System.out.println();
                        total++;
                    }
                }
                System.out.println(Console.BOLD + "Total related records: " + total + Console.RESET);
            }
            Console.rule();
        }
        System.out.println(Console.GREEN + "Goodbye." + Console.RESET);
        sc.close();
    }

    private static void printMenu() {
        System.out.println();
        System.out.println(Console.BOLD + "What would you like to search?" + Console.RESET);
        System.out.println("  1. Medicine");
        System.out.println("  2. Prescription");
        System.out.println("  3. Patient");
        System.out.println("  4. Inventory");
        System.out.println("  5. Dispensing Transaction");
        System.out.println("  6. Search Anything (all types)");
        System.out.println("  0. Exit");
    }
}
