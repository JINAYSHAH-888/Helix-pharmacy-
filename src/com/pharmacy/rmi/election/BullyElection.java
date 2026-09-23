package com.pharmacy.rmi.election;

import com.pharmacy.rmi.clock.LamportClock;
import com.pharmacy.rmi.util.Console;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Bully election algorithm for the distributed pharmacy nodes.
 *
 * Node priority is represented by a numeric node ID. The highest-ID node that
 * is currently alive becomes coordinator (leader). When a lower-ID node
 * detects that the coordinator is unavailable, it starts an election by
 * contacting every higher-ID alive node. Any higher node that answers OK
 * takes over the election, causing the highest alive node to eventually
 * announce itself with a COORDINATOR message.
 *
 * This class is deliberately self-contained and does not alter the existing
 * pharmacy RMI routing/search code. Lamport clocks are used only to timestamp
 * election messages in the terminal trace, reusing the project's existing
 * logical-clock implementation.
 */
public final class BullyElection {

    public enum NodeState {
        ALIVE,
        DOWN
    }

    public record PharmacyProcess(int id, String name, int port) {}

    private final Map<Integer, ProcessState> processes = new LinkedHashMap<>();
    private int coordinatorId = -1;
    private int electionNumber = 0;

    public BullyElection(List<PharmacyProcess> nodes) {
        if (nodes == null || nodes.isEmpty()) {
            throw new IllegalArgumentException("At least one pharmacy node is required.");
        }

        nodes.stream()
                .sorted(Comparator.comparingInt(PharmacyProcess::id))
                .forEach(node -> {
                    if (processes.containsKey(node.id())) {
                        throw new IllegalArgumentException("Duplicate node ID: " + node.id());
                    }
                    if (node.id() <= 0) {
                        throw new IllegalArgumentException("Node ID must be positive: " + node.id());
                    }
                    processes.put(node.id(), new ProcessState(node));
                });
    }

    /** Marks one pharmacy node unavailable. */
    public void failNode(int nodeId) {
        ProcessState node = requireNode(nodeId);
        node.state = NodeState.DOWN;
        if (coordinatorId == nodeId) {
            coordinatorId = -1;
        }
        logNodeState(node, "FAILED / DOWN");
    }

    /** Brings a pharmacy node back online. */
    public void recoverNode(int nodeId) {
        ProcessState node = requireNode(nodeId);
        node.state = NodeState.ALIVE;
        logNodeState(node, "RECOVERED / ALIVE");
    }

    /**
     * Starts a Bully election from the specified alive node.
     *
     * @return the elected coordinator's node ID
     */
    public int startElection(int initiatorId) {
        ProcessState initiator = requireNode(initiatorId);
        if (initiator.state != NodeState.ALIVE) {
            throw new IllegalStateException("Cannot start an election from a DOWN node: " + initiator.name());
        }

        electionNumber++;
        int currentElection = electionNumber;
        initiator.electionInProgress = true;
        initiator.lastElectionStarted = currentElection;

        Console.section("BULLY ELECTION #" + currentElection);
        Console.tag(Console.YELLOW, initiator.name(),
                "ELECTION started by node " + initiator.id()
                        + " (highest-priority node wins)");

        List<ProcessState> higherAlive = higherAliveNodes(initiator.id());
        if (higherAlive.isEmpty()) {
            announceCoordinator(initiator, currentElection);
            return coordinatorId;
        }

        for (ProcessState higher : higherAlive) {
            sendElectionMessage(initiator, higher, currentElection);
            receiveOkMessage(higher, initiator, currentElection);
        }

        // The OK responses mean that one or more higher-priority processes
        // are alive. Bully requires those higher processes to continue the
        // election rather than allowing the initiator to declare itself leader.
        for (ProcessState higher : higherAlive) {
            startElectionFromHigherNode(higher, currentElection);
        }

        // The highest alive node will eventually set coordinatorId.
        return coordinatorId;
    }

    /** Prints the current process/coordinator table. */
    public void printStatus() {
        Console.section("BULLY NODE STATUS");
        for (ProcessState node : processes.values()) {
            String coordinatorMarker = node.id == coordinatorId ? "  <-- COORDINATOR" : "";
            String state = node.state == NodeState.ALIVE ? "ALIVE" : "DOWN";
            System.out.printf("  Node %-2d | %-10s | %-11s | RMI :%d%s%n",
                    node.id, node.name, state, node.port, coordinatorMarker);
        }
        System.out.println();
    }

    /** Returns the currently elected coordinator or -1 when none exists. */
    public int getCoordinatorId() {
        return coordinatorId;
    }

    /** Returns the coordinator name or null when there is no coordinator. */
    public String getCoordinatorName() {
        ProcessState coordinator = processes.get(coordinatorId);
        return coordinator == null ? null : coordinator.name();
    }

    /** Used by the live router's failure detector before it starts an election. */
    public boolean isAlive(int nodeId) {
        return requireNode(nodeId).state == NodeState.ALIVE;
    }

    private void startElectionFromHigherNode(ProcessState initiator, int parentElection) {
        if (initiator.state != NodeState.ALIVE || initiator.lastElectionStarted == parentElection) {
            return;
        }
        initiator.lastElectionStarted = parentElection;
        initiator.electionInProgress = true;

        Console.tag(Console.BLUE, initiator.name(),
                "OK received -> taking over election (higher ID than initiator)");

        List<ProcessState> higherAlive = higherAliveNodes(initiator.id());
        if (higherAlive.isEmpty()) {
            announceCoordinator(initiator, parentElection);
            return;
        }

        // Do not increment the global election number here: this is the same
        // Bully election cascading upward from the original failure detector.
        for (ProcessState higher : higherAlive) {
            sendElectionMessage(initiator, higher, parentElection);
            receiveOkMessage(higher, initiator, parentElection);
        }

        for (ProcessState higher : higherAlive) {
            startElectionFromHigherNode(higher, parentElection);
        }
    }

    private void announceCoordinator(ProcessState winner, int electionId) {
        coordinatorId = winner.id();
        for (ProcessState process : processes.values()) {
            process.electionInProgress = false;
        }

        Console.tag(Console.GREEN, winner.name(),
                "No higher alive node -> WINNER for election #" + electionId);

        Console.tag(Console.MAGENTA, winner.name(),
                "COORDINATOR message broadcast to all alive nodes");

        for (ProcessState process : processes.values()) {
            if (process.id() == winner.id() || process.state != NodeState.ALIVE) {
                continue;
            }
            receiveCoordinatorMessage(winner, process, electionId);
        }

        Console.tag(Console.GREEN, winner.name(),
                "ELECTION COMPLETE -> coordinator = Node " + winner.id() + " (" + winner.name() + ")");
        Console.rule();
    }

    private void sendElectionMessage(ProcessState from, ProcessState to, int electionId) {
        long sendTs = from.clock.tick();
        Console.tag(Console.CYAN, from.name(),
                String.format("ELECTION  -> %-10s | id=%d | election=%d | %s",
                        to.name(), to.id(), electionId, Console.lamportSend(sendTs)));
    }

    private void receiveOkMessage(ProcessState from, ProcessState to, int electionId) {
        long receiveTs = from.clock.tick();
        Console.tag(Console.BLUE, from.name(),
                String.format("OK        -> %-10s | higher node is alive | election=%d | local-ts=%d",
                        to.name(), electionId, receiveTs));
    }

    private void receiveCoordinatorMessage(ProcessState from, ProcessState to, int electionId) {
        long localTs = to.clock.sync(from.clock.get());
        Console.tag(Console.MAGENTA, to.name(),
                String.format("COORDINATOR <- %-10s | elected-id=%d | election=%d | %s",
                        from.name(), from.id(), electionId, Console.lamportRecv(from.clock.get(), localTs)));
    }

    private List<ProcessState> higherAliveNodes(int id) {
        List<ProcessState> result = new ArrayList<>();
        for (ProcessState process : processes.values()) {
            if (process.id() > id && process.state == NodeState.ALIVE) {
                result.add(process);
            }
        }
        return result;
    }

    private ProcessState requireNode(int nodeId) {
        ProcessState node = processes.get(nodeId);
        if (node == null) {
            throw new IllegalArgumentException("Unknown pharmacy node ID: " + nodeId);
        }
        return node;
    }

    private void logNodeState(ProcessState node, String description) {
        String color = node.state == NodeState.ALIVE ? Console.GREEN : Console.RED;
        Console.tag(color, node.name(),
                description + " | node-id=" + node.id() + " | RMI=localhost:" + node.port());
    }

    private static final class ProcessState {
        private final int id;
        private final String name;
        private final int port;
        private final LamportClock clock = new LamportClock();
        private NodeState state = NodeState.ALIVE;
        private boolean electionInProgress;
        private int lastElectionStarted = -1;

        private ProcessState(PharmacyProcess process) {
            this.id = process.id();
            this.name = process.name();
            this.port = process.port();
        }

        private int id() { return id; }
        private String name() { return name; }
        private int port() { return port; }
    }
}
