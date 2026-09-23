package com.pharmacy.rmi.server;
import com.pharmacy.rmi.model.*;
import java.rmi.Remote;
import java.rmi.RemoteException;
public interface PharmacyNode extends Remote {
    NodeSearchResult search(SearchRequest request) throws RemoteException;
    String getServerName() throws RemoteException;
}
