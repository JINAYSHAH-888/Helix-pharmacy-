package com.pharmacy.rmi.model;
import java.io.Serializable;
public record Inventory(String id,String branchId,String medicineId,int quantity,int reorderThreshold,String vectorClock,String syncStatus) implements Serializable {}
