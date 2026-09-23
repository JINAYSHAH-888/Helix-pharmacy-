package com.pharmacy.rmi.model;
import java.io.Serializable;
public record DispensingTransaction(String id,String prescriptionId,String branchId,String pharmacist,String license,int quantity,String idempotencyKey,String dispensedAt,String syncStatus) implements Serializable {}
