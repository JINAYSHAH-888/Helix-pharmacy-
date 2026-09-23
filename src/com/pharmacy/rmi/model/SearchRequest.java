package com.pharmacy.rmi.model;
import java.io.Serializable;
public class SearchRequest implements Serializable {
    private final SearchType type;
    private final String query;
    private final long lamportTimestamp;

    public SearchRequest(SearchType type, String query, long lamportTimestamp) {
        this.type = type;
        this.query = query;
        this.lamportTimestamp = lamportTimestamp;
    }

    /** Backwards-compatible constructor (no clock value supplied -> 0). */
    public SearchRequest(SearchType type, String query) {
        this(type, query, 0L);
    }

    public SearchType getType() { return type; }
    public String getQuery() { return query; }
    public long getLamportTimestamp() { return lamportTimestamp; }
}
