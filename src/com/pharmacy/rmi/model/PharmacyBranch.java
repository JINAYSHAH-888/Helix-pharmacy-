package com.pharmacy.rmi.model;
import java.io.Serializable;
public record PharmacyBranch(String id,String code,String name,String city,String state,String status) implements Serializable {}
