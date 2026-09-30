package com.pharmacy.rmi.balancer;

import java.util.Locale;

/**
 * The load-balancing algorithms the lab can run.
 *
 * Each constant carries the text the control room prints beside it, so the page and the
 * engine can never disagree about what an algorithm claims to do.
 */
public enum Strategy {
    ROUND_ROBIN("Round robin", "i = (i + 1) mod n",
            "Walks the healthy backends in order. No state per request beyond one cursor.",
            "Even distribution when every node is equally fast. Ignores load, so one slow node still gets its full share."),

    WEIGHTED_ROUND_ROBIN("Weighted round robin", "cw_i += w_i ; pick max(cw) ; cw_pick -= Σw",
            "Nginx's smooth weighted round robin: each node accumulates its weight, the highest total wins and pays the sum back.",
            "Sends traffic in proportion to declared capacity, and spreads it smoothly instead of in bursts of one node."),

    LEAST_CONNECTIONS("Least connections", "argmin(inFlight_i)",
            "Picks the backend with the fewest requests still open, breaking ties on the faster average.",
            "Self-correcting under uneven request cost: a node that is stuck stops being chosen."),

    LEAST_RESPONSE_TIME("Least response time", "argmin(ewma_i × (inFlight_i + 1))",
            "Scores each backend by its exponentially weighted mean latency multiplied by its queue depth.",
            "Reacts to a node getting slower before its queue visibly grows. The classic 'peak EWMA' rule."),

    POWER_OF_TWO("Power of two choices", "argmin(inFlight) over 2 random",
            "Samples two healthy backends at random and keeps the less busy one.",
            "Almost the quality of least-connections at the cost of random, with none of the herd effect of every balancer picking the same node."),

    CONSISTENT_HASH("Consistent hashing", "ring.ceil(sha256(key)) , 160 vnodes",
            "Maps the request key onto a hash ring of 160 virtual nodes per backend and takes the next node clockwise.",
            "The same key lands on the same node, so caches stay warm. Removing a node moves only its own share of keys, not all of them."),

    RANDOM("Random", "i = uniform(0, n)",
            "Uniformly random healthy backend. The baseline every other algorithm is measured against.",
            "No state at all and no coordination. Fair on average, but its variance is what the others exist to remove.");

    private final String label;
    private final String formula;
    private final String how;
    private final String why;

    Strategy(String label, String formula, String how, String why) {
        this.label = label;
        this.formula = formula;
        this.how = how;
        this.why = why;
    }

    public String label() { return label; }
    public String formula() { return formula; }
    public String how() { return how; }
    public String why() { return why; }

    /** True when the algorithm routes on the request key rather than on node load. */
    public boolean keyed() { return this == CONSISTENT_HASH; }

    public static Strategy parse(String raw) {
        if (raw == null || raw.isBlank()) return ROUND_ROBIN;
        String name = raw.trim().toUpperCase(Locale.ROOT).replace('-', '_').replace(' ', '_');
        for (Strategy strategy : values()) if (strategy.name().equals(name)) return strategy;
        throw new IllegalArgumentException("Unknown strategy: " + raw);
    }
}
