package com.pharmacy.rmi.api;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.Locale;

/**
 * Small, explicit primary-backup failure-tolerance lab for the browser UI.
 *
 * This is intentionally separate from the PostgreSQL pharmacy data (PharmacyData) and the supplied RMI
 * nodes. It gives the operator a deterministic way to observe failover,
 * degraded writes, rejoin, and replay without mutating pharmacy records.
 * State lives only in the web-gateway process and resets on restart.
 */
public final class PrimaryBackupSimulation {
    private static final String PRIMARY = "Mumbai";
    private static final String BACKUP = "Pune";
    private static final String PRIMARY_BRANCH = "BR-MUM-02";
    private static final String BACKUP_BRANCH = "BR-PUN-06";

    private boolean primaryAvailable;
    private boolean backupAvailable;
    private boolean backupPromoted;
    private int term;
    private long nextSequence;
    private int failoverCount;
    private int replayCount;
    private String phase;
    private String lastAction;
    private final List<StoredEvent> events = new ArrayList<>();
    private final Deque<AuditEntry> audit = new ArrayDeque<>();

    public PrimaryBackupSimulation() {
        resetState();
    }

    public synchronized Snapshot snapshot() {
        List<EventView> eventViews = events.stream().map(StoredEvent::view).toList();
        List<EventView> latestFirst = new ArrayList<>(eventViews);
        Collections.reverse(latestFirst);

        List<AuditView> auditViews = new ArrayList<>(audit.stream().map(AuditEntry::view).toList());
        Collections.reverse(auditViews);
        List<NodeView> nodes = List.of(
                nodeView(PRIMARY, PRIMARY_BRANCH, 1099, "PRIMARY"),
                nodeView(BACKUP, BACKUP_BRANCH, 1100, "BACKUP"));
        long lag = events.stream().filter(event -> !event.fullyReplicated()).count();
        long replicated = events.stream().filter(StoredEvent::fullyReplicated).count();

        return new Snapshot(
                phase,
                backupPromoted ? "BACKUP_PROMOTED" : "PRIMARY_ACTIVE",
                activeNode(),
                PRIMARY,
                BACKUP,
                term,
                failoverCount,
                replayCount,
                events.size(),
                replicated,
                lag,
                primaryAvailable,
                backupAvailable,
                lastAction,
                Instant.now().toString(),
                nodes,
                latestFirst,
                auditViews);
    }

    public synchronized Snapshot apply(String rawAction) {
        Action action = Action.parse(rawAction);
        switch (action) {
            case APPEND -> appendEvent();
            case FAIL_PRIMARY -> failPrimary();
            case RECOVER_PRIMARY -> recoverPrimary();
            case RESET -> resetState();
        }
        return snapshot();
    }

    private void resetState() {
        primaryAvailable = true;
        backupAvailable = true;
        backupPromoted = false;
        term = 1;
        nextSequence = 3;
        failoverCount = 0;
        replayCount = 0;
        phase = "SYNCED";
        lastAction = "Simulation initialized with 3 records committed on both replicas";
        events.clear();
        audit.clear();
        events.add(new StoredEvent(1, "FT-0001", "DISP-BR02 / MED-0008 / 2 units", "COMMITTED", true, true, PRIMARY, term, false));
        events.add(new StoredEvent(2, "FT-0002", "DISP-BR05 / MED-0004 / 1 unit", "COMMITTED", true, true, PRIMARY, term, false));
        events.add(new StoredEvent(3, "FT-0003", "DISP-BR01 / MED-0007 / 1 unit", "COMMITTED", true, true, PRIMARY, term, false));
        audit.addLast(new AuditEntry("BOOTSTRAP", "Mumbai primary + Pune backup initialized", term));
        audit.addLast(new AuditEntry("REPLICATION", "3 records confirmed on both replicas", term));
    }

    private void failPrimary() {
        if (!primaryAvailable) {
            lastAction = "Mumbai is already failed; the Pune promotion remains active";
            audit.addLast(new AuditEntry("NO-OP", lastAction, term));
            return;
        }
        primaryAvailable = false;
        backupPromoted = true;
        term += 1;
        failoverCount += 1;
        phase = "DEGRADED";
        lastAction = "Mumbai failed; Pune promoted to primary in term " + term;
        audit.addLast(new AuditEntry("FAILOVER", lastAction, term));
        audit.addLast(new AuditEntry("ELECTION", "Bully priority selected the reachable backup", term));
    }

    private void appendEvent() {
        if (!activeNodeAvailable()) {
            phase = "NO_PRIMARY";
            lastAction = "Write rejected: no active replica is available";
            audit.addLast(new AuditEntry("REJECTED", lastAction, term));
            return;
        }
        nextSequence += 1;
        boolean both = primaryAvailable && backupAvailable;
        String key = String.format(Locale.ROOT, "FT-%04d", nextSequence);
        String commitState = both ? "COMMITTED" : "DEGRADED_COMMIT";
        events.add(new StoredEvent(
                nextSequence,
                key,
                "DISP-SIM / MED-0008 / 1 unit",
                commitState,
                primaryAvailable,
                backupAvailable,
                activeNode(),
                term,
                false));
        phase = both ? "SYNCED" : "DEGRADED";
        lastAction = both
                ? key + " committed and acknowledged by both replicas"
                : key + " accepted by the promoted primary; replay is pending";
        audit.addLast(new AuditEntry(both ? "REPLICATION" : "DEGRADED_WRITE", lastAction, term));
    }

    private void recoverPrimary() {
        if (primaryAvailable) {
            lastAction = backupPromoted
                    ? "Mumbai is already rejoined; Pune remains the active primary"
                    : "Mumbai is healthy; no recovery is required";
            audit.addLast(new AuditEntry("NO-OP", lastAction, term));
            return;
        }
        primaryAvailable = true;
        phase = "CATCHING_UP";
        int replayed = 0;
        for (int index = 0; index < events.size(); index++) {
            StoredEvent event = events.get(index);
            if (!event.primaryAck()) {
                events.set(index, event.withReplay());
                replayed += 1;
            }
        }
        replayCount += replayed;
        phase = "SYNCED";
        lastAction = "Mumbai rejoined and replayed " + replayed + " event" + (replayed == 1 ? "" : "s") + "; Pune stays primary";
        audit.addLast(new AuditEntry("REJOIN", "Mumbai is healthy and catching up from the event log", term));
        audit.addLast(new AuditEntry("REPLAY", lastAction, term));
    }

    private boolean activeNodeAvailable() {
        return backupPromoted ? backupAvailable : primaryAvailable;
    }

    private String activeNode() {
        return backupPromoted ? BACKUP : PRIMARY;
    }

    private NodeView nodeView(String name, String branchCode, int port, String configuredRole) {
        boolean isPrimary = PRIMARY.equals(name);
        boolean available = isPrimary ? primaryAvailable : backupAvailable;
        String role;
        String state;
        if (!available) {
            role = isPrimary ? "FAILED PRIMARY" : "FAILED BACKUP";
            state = "OFFLINE";
        } else if (backupPromoted && isPrimary) {
            role = "REJOINED BACKUP";
            state = "IN SYNC";
        } else if (backupPromoted) {
            role = "PROMOTED PRIMARY";
            state = "ACTIVE";
        } else if (isPrimary) {
            role = "PRIMARY";
            state = "ACTIVE";
        } else {
            role = "BACKUP";
            state = "IN SYNC";
        }
        return new NodeView(name, branchCode, port, configuredRole, role, state, available, available && events.stream().allMatch(event -> isPrimary ? event.primaryAck() : event.backupAck()));
    }

    private record StoredEvent(
            long sequence,
            String key,
            String payload,
            String commitState,
            boolean primaryAck,
            boolean backupAck,
            String committedBy,
            int term,
            boolean replayed) {
        private boolean fullyReplicated() {
            return primaryAck && backupAck;
        }

        private StoredEvent withReplay() {
            return new StoredEvent(sequence, key, payload, "REPLAYED_AFTER_RECOVERY", true, backupAck, committedBy, term, true);
        }

        private EventView view() {
            return new EventView(sequence, key, payload, commitState, primaryAck, backupAck, committedBy, term, replayed);
        }
    }

    private record AuditEntry(String type, String message, int term) {
        private AuditView view() {
            return new AuditView(Instant.now().toString(), type, message, term);
        }
    }

    private enum Action {
        APPEND,
        FAIL_PRIMARY,
        RECOVER_PRIMARY,
        RESET;

        private static Action parse(String rawAction) {
            String normalized = rawAction == null ? "" : rawAction.trim().toUpperCase(Locale.ROOT).replace('-', '_');
            return switch (normalized) {
                case "APPEND", "WRITE", "APPEND_EVENT" -> APPEND;
                case "FAIL_PRIMARY", "FAIL" -> FAIL_PRIMARY;
                case "RECOVER_PRIMARY", "RECOVER", "REJOIN" -> RECOVER_PRIMARY;
                case "RESET" -> RESET;
                default -> throw new IllegalArgumentException("Unknown fault-tolerance action: " + rawAction);
            };
        }
    }

    public record NodeView(String name, String branchCode, int port, String configuredRole, String role, String state, boolean available, boolean caughtUp) {}

    public record EventView(long sequence, String key, String payload, String commitState, boolean primaryAck, boolean backupAck, String committedBy, int term, boolean replayed) {}

    public record AuditView(String occurredAt, String type, String message, int term) {}

    public record Snapshot(
            String phase,
            String mode,
            String activeNode,
            String configuredPrimary,
            String configuredBackup,
            int term,
            int failoverCount,
            int replayCount,
            long committedEvents,
            long replicatedEvents,
            long replicationLag,
            boolean primaryAvailable,
            boolean backupAvailable,
            String lastAction,
            String updatedAt,
            List<NodeView> nodes,
            List<EventView> events,
            List<AuditView> audit) {}
}
