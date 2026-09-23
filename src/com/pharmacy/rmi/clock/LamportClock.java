package com.pharmacy.rmi.clock;

import java.io.Serializable;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Lamport logical clock.
 *
 * Rules implemented (Lamport, 1978):
 *  1. Before a local/internal event (including preparing to send a message),
 *     a process increments its own clock: C = C + 1.
 *  2. Every message carries the sender's clock value at send time.
 *  3. On receiving a message with timestamp T, the receiver sets
 *     C = max(C, T) + 1.
 *
 * The counter is a `long` (not `int`) so it cannot silently wrap around
 * during a long-running demo / many concurrent RMI calls (an int counter
 * would overflow after ~2.1 billion ticks; a long effectively never will).
 *
 * Thread-safe: backed by AtomicLong so it is safe to share a single
 * LamportClock instance across the RMI worker threads that call into the
 * same node/router object concurrently.
 */
public class LamportClock implements Serializable {

    private final AtomicLong counter = new AtomicLong(0L);

    /**
     * Register a local event (or "about to send a message") and return the
     * new timestamp to attach to that event / outgoing message.
     */
    public long tick() {
        return counter.incrementAndGet();
    }

    /**
     * Synchronize this clock against a timestamp received from another
     * process: C = max(C, receivedTimestamp) + 1. Returns the new local
     * timestamp after synchronization.
     */
    public long sync(long receivedTimestamp) {
        return counter.updateAndGet(local -> Math.max(local, receivedTimestamp) + 1L);
    }

    /** Current clock value without advancing it. */
    public long get() {
        return counter.get();
    }

    @Override
    public String toString() {
        return "LamportClock{t=" + counter.get() + "}";
    }
}
