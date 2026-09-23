package com.pharmacy.rmi.model;
import java.io.Serializable;
import java.util.*;
public class SearchResponse implements Serializable {
    private final SearchRequest request;
    private final List<NodeSearchResult> nodeResults;
    private final long lamportTimestamp;

    public SearchResponse(SearchRequest request, List<NodeSearchResult> nodeResults, long lamportTimestamp) {
        this.request = request;
        this.nodeResults = new ArrayList<>(nodeResults);
        this.lamportTimestamp = lamportTimestamp;
    }

    /** Backwards-compatible constructor (no clock value supplied -> 0). */
    public SearchResponse(SearchRequest request, List<NodeSearchResult> nodeResults) {
        this(request, nodeResults, 0L);
    }

    public SearchRequest getRequest() { return request; }
    public List<NodeSearchResult> getNodeResults() { return Collections.unmodifiableList(nodeResults); }
    public boolean found() { return nodeResults.stream().anyMatch(NodeSearchResult::hasMatches); }
    public long getLamportTimestamp() { return lamportTimestamp; }
}
