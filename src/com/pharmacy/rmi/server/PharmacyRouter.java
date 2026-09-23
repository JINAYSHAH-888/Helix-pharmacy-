package com.pharmacy.rmi.server;
import com.pharmacy.rmi.model.*;
import java.rmi.Remote;
import java.rmi.RemoteException;
public interface PharmacyRouter extends Remote {
    SearchResponse search(SearchRequest request) throws RemoteException;
}
