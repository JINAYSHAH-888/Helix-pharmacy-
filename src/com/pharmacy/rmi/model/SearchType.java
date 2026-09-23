package com.pharmacy.rmi.model;
import java.io.Serializable;
public enum SearchType implements Serializable {
    MEDICINE, PRESCRIPTION, PATIENT, INVENTORY, TRANSACTION, ANY
}
