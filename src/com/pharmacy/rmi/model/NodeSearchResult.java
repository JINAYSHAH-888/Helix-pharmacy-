package com.pharmacy.rmi.model;
import java.io.Serializable;
import java.util.*;
public class NodeSearchResult implements Serializable {
    private final String serverName;
    private final List<String> matches;
    private final long lamportTimestamp;

    public NodeSearchResult(String serverName, List<String> matches, long lamportTimestamp) {
        this.serverName = serverName;
        this.matches = new ArrayList<>(matches);
        this.lamportTimestamp = lamportTimestamp;
    }

    /** Backwards-compatible constructor (no clock value supplied -> 0). */
    public NodeSearchResult(String serverName, List<String> matches) {
        this(serverName, matches, 0L);
    }

    public String getServerName() { return serverName; }
    public List<String> getMatches() { return Collections.unmodifiableList(matches); }
    public boolean hasMatches() { return !matches.isEmpty(); }
    public long getLamportTimestamp() { return lamportTimestamp; }
}
