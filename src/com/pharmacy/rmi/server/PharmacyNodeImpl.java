package com.pharmacy.rmi.server;

import com.pharmacy.rmi.model.*;
import com.pharmacy.rmi.clock.LamportClock;
import com.pharmacy.rmi.util.Console;
import java.rmi.server.UnicastRemoteObject;
import java.rmi.RemoteException;
import java.util.*;

public class PharmacyNodeImpl extends UnicastRemoteObject implements PharmacyNode {
    private final String serverName;
    private final Set<String> ownedBranchIds;
    private final LamportClock clock = new LamportClock();

    public PharmacyNodeImpl(String serverName, Set<String> ownedBranchIds) throws RemoteException {
        super();
        this.serverName = serverName;
        this.ownedBranchIds = Set.copyOf(ownedBranchIds);
    }

    public String getServerName() { return serverName; }

    public NodeSearchResult search(SearchRequest request) {
        // Lamport rule 3: receiving a message -> C = max(C, T) + 1
        long syncedTs = clock.sync(request.getLamportTimestamp());
        Console.tag(Console.CYAN, serverName,
                "REQUEST  type=" + request.getType() + "  query=\"" + request.getQuery() + "\"  "
                        + Console.lamportRecv(request.getLamportTimestamp(), syncedTs));
        String q = request.getQuery().trim().toLowerCase(Locale.ROOT);
        List<String> out = new ArrayList<>();

        for (Medicine m : HardcodedData.MEDICINES) {
            if ((request.getType()==SearchType.MEDICINE || request.getType()==SearchType.ANY)
                    && locallyRelevantMedicine(m.id())
                    && (m.code().toLowerCase(Locale.ROOT).contains(q)
                    || m.name().toLowerCase(Locale.ROOT).contains(q)
                    || m.genericName().toLowerCase(Locale.ROOT).contains(q))) {
                out.add(formatMedicine(m));
            }
        }

        for (Prescription p : HardcodedData.PRESCRIPTIONS) {
            if (!ownedBranchIds.contains(p.branchId())) continue;
            boolean direct = p.id().toLowerCase(Locale.ROOT).contains(q)
                    || p.hash().toLowerCase(Locale.ROOT).contains(q)
                    || p.patientId().toLowerCase(Locale.ROOT).contains(q)
                    || p.patientName().toLowerCase(Locale.ROOT).contains(q)
                    || p.doctorName().toLowerCase(Locale.ROOT).contains(q);
            boolean medicineMatch = relatedMedicine(p.medicineId(), q);

            if ((request.getType()==SearchType.PRESCRIPTION || request.getType()==SearchType.ANY) && direct)
                out.add(formatPrescription(p));
            if (request.getType()==SearchType.PATIENT
                    && (p.patientId().toLowerCase(Locale.ROOT).contains(q)
                    || p.patientName().toLowerCase(Locale.ROOT).contains(q)))
                out.add(formatPrescription(p));
            if (request.getType()==SearchType.MEDICINE && medicineMatch)
                out.add(formatPrescription(p));
        }

        for (Inventory i : HardcodedData.INVENTORY) {
            if (!ownedBranchIds.contains(i.branchId())) continue;
            boolean medMatch = relatedMedicine(i.medicineId(), q);
            boolean match = switch (request.getType()) {
                case INVENTORY -> i.id().toLowerCase(Locale.ROOT).contains(q) || medMatch;
                case MEDICINE -> medMatch;
                case ANY -> i.id().toLowerCase(Locale.ROOT).contains(q) || medMatch;
                default -> false;
            };
            if (match) out.add(formatInventory(i));
        }

        for (DispensingTransaction t : HardcodedData.TRANSACTIONS) {
            if (!ownedBranchIds.contains(t.branchId())) continue;
            boolean txMatch = t.id().toLowerCase(Locale.ROOT).contains(q)
                    || t.idempotencyKey().toLowerCase(Locale.ROOT).contains(q);
            boolean rxMatch = t.prescriptionId().toLowerCase(Locale.ROOT).contains(q);
            if ((request.getType()==SearchType.TRANSACTION && (txMatch || rxMatch))
                    || (request.getType()==SearchType.PRESCRIPTION && rxMatch)
                    || (request.getType()==SearchType.ANY && (txMatch || rxMatch)))
                out.add(formatTransaction(t));
        }

        // Lamport rule 1/2: about to send a reply -> increment, attach timestamp
        long sendTs = clock.tick();
        List<String> distinct = new ArrayList<>(new LinkedHashSet<>(out));
        Console.tag(Console.CYAN, serverName,
                "REPLY    " + distinct.size() + " match(es)  " + Console.lamportSend(sendTs));
        return new NodeSearchResult(serverName, distinct, sendTs);
    }

    private boolean locallyRelevantMedicine(String medicineId) {
        return HardcodedData.INVENTORY.stream().anyMatch(i -> ownedBranchIds.contains(i.branchId()) && i.medicineId().equals(medicineId))
            || HardcodedData.PRESCRIPTIONS.stream().anyMatch(p -> ownedBranchIds.contains(p.branchId()) && p.medicineId().equals(medicineId));
    }
    private boolean relatedMedicine(String medicineId, String q) {
        Medicine m=HardcodedData.medicineById(medicineId);
        return m!=null && (m.id().equalsIgnoreCase(q) || m.code().equalsIgnoreCase(q)
                || m.name().toLowerCase(Locale.ROOT).contains(q)
                || m.genericName().toLowerCase(Locale.ROOT).contains(q));
    }
    private String formatMedicine(Medicine m) {
        return String.format(
            "[MEDICINE]   %s - %s%n" +
            "             Generic: %-28s Category: %s%n" +
            "             Controlled: %-25s Schedule: %s%n" +
            "             Unit: %-30s Manufacturer: %s",
            m.code(), m.name(), m.genericName(), m.category(),
            m.controlled(), m.scheduleClass(), m.unit(), m.manufacturer());
    }
    private String formatPrescription(Prescription p) {
        Medicine m=HardcodedData.medicineById(p.medicineId());
        PharmacyBranch b=HardcodedData.branchById(p.branchId());
        return String.format(
            "[PRESCRIPTION] %s  -  Status: %s%n" +
            "             Patient: %s (%s)%n" +
            "             Doctor : %s%n" +
            "             Medicine: %-28s Qty: %-6s Dosage: %s%n" +
            "             Issued : %-15s Expiry: %s%n" +
            "             Branch : %s%n" +
            "             Hash   : %s",
            p.id(), p.status(), p.patientName(), p.patientId(), p.doctorName(),
            (m==null?p.medicineId():m.code()+" / "+m.name()), p.quantity(), p.dosage(),
            p.issueDate(), p.expiryDate(),
            (b==null?p.branchId():b.code()+" / "+b.city()), p.hash());
    }
    private String formatInventory(Inventory i) {
        PharmacyBranch b=HardcodedData.branchById(i.branchId());
        Medicine m=HardcodedData.medicineById(i.medicineId());
        return String.format(
            "[INVENTORY]  %s%n" +
            "             Medicine : %s%n" +
            "             Available: %-10s Reorder at: %s%n" +
            "             Vector Clock: %-20s Sync: %s",
            (b==null?i.branchId():b.code()+" / "+b.city()),
            (m==null?i.medicineId():m.code()+" / "+m.name()),
            i.quantity(), i.reorderThreshold(), i.vectorClock(), i.syncStatus());
    }
    private String formatTransaction(DispensingTransaction t) {
        PharmacyBranch b=HardcodedData.branchById(t.branchId());
        return String.format(
            "[DISPENSING] %s%n" +
            "             Prescription: %-25s Branch: %s%n" +
            "             Pharmacist  : %-25s Qty:    %s%n" +
            "             Idempotency : %s%n" +
            "             Dispensed At: %-25s Sync:   %s",
            t.id(), t.prescriptionId(), (b==null?t.branchId():b.code()+" / "+b.city()),
            t.pharmacist(), t.quantity(), t.idempotencyKey(), t.dispensedAt(), t.syncStatus());
    }
}
