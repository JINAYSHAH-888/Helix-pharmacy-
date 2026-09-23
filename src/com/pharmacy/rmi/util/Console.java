package com.pharmacy.rmi.util;

/**
 * Small helper for readable, consistent terminal output across the client,
 * router, and pharmacy nodes. Centralizing this keeps every log line in the
 * same visual style (colors, banners, tags) without duplicating formatting
 * logic in every class.
 */
public final class Console {
    private Console() {}

    // ---- ANSI colors (safe no-ops on terminals that don't support them) ----
    public static final String RESET   = "\u001B[0m";
    public static final String BOLD    = "\u001B[1m";
    public static final String DIM     = "\u001B[2m";

    public static final String CYAN    = "\u001B[36m";
    public static final String GREEN   = "\u001B[32m";
    public static final String YELLOW  = "\u001B[33m";
    public static final String BLUE    = "\u001B[34m";
    public static final String MAGENTA = "\u001B[35m";
    public static final String RED     = "\u001B[31m";
    public static final String GRAY    = "\u001B[90m";

    private static final int WIDTH = 70;

    /** Prints a full-width banner box with a title and key/value lines. */
    public static void banner(String color, String title, String... lines) {
        String bar = "=".repeat(WIDTH);
        System.out.println(color + bar + RESET);
        System.out.println(color + BOLD + center(title) + RESET);
        System.out.println(color + bar + RESET);
        for (String l : lines) {
            System.out.println("  " + l);
        }
        System.out.println(color + bar + RESET + "\n");
    }

    /** Prints a thin section divider with a label, e.g. ---- ROUTING RESULT ---- */
    public static void section(String label) {
        int pad = Math.max(2, (WIDTH - label.length() - 2) / 2);
        String side = "-".repeat(pad);
        System.out.println("\n" + BOLD + side + " " + label + " " + side + RESET);
    }

    /** Prints a thin closing rule matching section() width. */
    public static void rule() {
        System.out.println(DIM + "-".repeat(WIDTH) + RESET);
    }

    /** A tagged log line, e.g. [Mumbai] in cyan, with an aligned message. */
    public static void tag(String color, String tag, String message) {
        System.out.println(color + BOLD + "[" + tag + "]" + RESET + " " + message);
    }

    /** Formats a Lamport clock transition consistently everywhere. */
    public static String lamportRecv(long incoming, long local) {
        return GRAY + "clock: recv=" + incoming + " -> local=" + local + RESET;
    }

    public static String lamportSend(long sendTs) {
        return GRAY + "clock: send=" + sendTs + RESET;
    }

    public static String lamportRoundTrip(long sendTs, long recvTs, long local) {
        return GRAY + "clock: send=" + sendTs + " recv=" + recvTs + " -> local=" + local + RESET;
    }

    private static String center(String s) {
        int pad = Math.max(0, (WIDTH - s.length()) / 2);
        return " ".repeat(pad) + s;
    }
}
