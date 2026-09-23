package com.pharmacy.rmi.model;
import java.io.Serializable;
public record Prescription(String id,String hash,String patientName,String patientId,String doctorName,String doctorLicense,String branchId,String medicineId,int quantity,String dosage,String issueDate,String expiryDate,String status) implements Serializable {}
