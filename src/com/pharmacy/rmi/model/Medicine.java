package com.pharmacy.rmi.model;
import java.io.Serializable;
public record Medicine(String id,String code,String name,String genericName,String category,boolean controlled,String scheduleClass,String unit,String manufacturer) implements Serializable {}
