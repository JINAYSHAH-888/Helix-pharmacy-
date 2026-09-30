package com.pharmacy.rmi.server;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Add / update rows from the control room's data explorer.
 *
 * Only whitelisted fields are writable; each maps a UI key to a column and a SQL value
 * expression (casts, or a lookup from a branch/medicine code to its UUID). Every write
 * invalidates the {@link PharmacyData} cache, so the next read shows it.
 */
public final class RecordWriter {
    private RecordWriter() {}

    private record Field(String key, String column, String expr, boolean optional) {}

    private record Table(String name, String pk, boolean insertable, List<Field> fields) {}

    private static Field f(String key, String column, String expr) { return new Field(key, column, expr, false); }
    private static Field opt(String key, String column, String expr) { return new Field(key, column, expr, true); }

    private static final String BRANCH = "(SELECT branch_id FROM pharmacy_branches WHERE branch_code = ?)";
    private static final String MEDICINE = "(SELECT medicine_id FROM medicines WHERE medicine_code = ?)";

    private static final Map<String, Table> TABLES = Map.of(
            "medicines", new Table("medicines", "medicine_id", true, List.of(
                    f("code", "medicine_code", "?"), f("name", "name", "?"), f("genericName", "generic_name", "?"),
                    f("category", "category", "?"), f("controlled", "is_controlled_substance", "?::boolean"),
                    opt("scheduleClass", "schedule_class", "?"), f("unit", "unit_of_measure", "?"),
                    f("manufacturer", "manufacturer", "?"))),
            "prescriptions", new Table("prescriptions", "prescription_id", true, List.of(
                    f("patientName", "patient_name", "?"), f("patientId", "patient_national_id", "?"),
                    f("doctorName", "doctor_name", "?"), f("doctorLicense", "doctor_license_no", "?"),
                    f("branchCode", "issuing_branch_id", BRANCH), f("medicineCode", "medicine_id", MEDICINE),
                    f("quantity", "prescribed_quantity", "?::int"), opt("dosage", "dosage_instructions", "?"),
                    f("issueDate", "issue_date", "?::date"), f("expiryDate", "expiry_date", "?::date"),
                    f("status", "status", "?::prescription_status_enum"))),
            "inventory", new Table("branch_inventory", "inventory_id", true, List.of(
                    f("branchCode", "branch_id", BRANCH), f("medicineCode", "medicine_id", MEDICINE),
                    f("quantity", "quantity_available", "?::int"), f("reorderThreshold", "reorder_threshold", "?::int"),
                    f("syncStatus", "sync_status", "?::inventory_sync_enum"))),
            "transactions", new Table("dispensing_transactions", "transaction_id", true, List.of(
                    f("prescriptionId", "prescription_id", "?::uuid"), f("branchCode", "dispensing_branch_id", BRANCH),
                    f("pharmacist", "pharmacist_name", "?"), f("license", "pharmacist_license_no", "?"),
                    f("quantity", "quantity_dispensed", "?::int"), f("idempotencyKey", "idempotency_key", "?"),
                    f("syncStatus", "sync_status", "?::dispensing_sync_enum"))),
            // the branch registry is pinned to the six RMI nodes: rows can be edited, not added
            "branches", new Table("pharmacy_branches", "branch_id", false, List.of(
                    f("name", "branch_name", "?"), f("city", "city", "?"), f("state", "state", "?"),
                    f("declaredStatus", "node_status", "?::node_status_enum"))));

    /** Inserts a row; returns its new id. */
    public static String insert(String dataset, Map<String, String> values) throws SQLException {
        Table table = table(dataset);
        if (!table.insertable()) throw new IllegalArgumentException("New branches need a new RMI node; edit an existing branch instead.");
        List<String> columns = new ArrayList<>();
        List<String> exprs = new ArrayList<>();
        List<String> params = new ArrayList<>();
        for (Field field : table.fields()) {
            String value = clean(values.get(field.key()));
            if (value == null && !field.optional()) throw new IllegalArgumentException("Missing required field: " + field.key());
            columns.add(field.column());
            exprs.add(field.expr());
            params.add(value);
        }
        if (dataset.equals("prescriptions")) {   // tamper-evident signature over the contents
            columns.add("prescription_hash");
            exprs.add("?");
            params.add(sha256(String.join("|", params.stream().map(String::valueOf).toList()) + "|" + UUID.randomUUID()));
        }
        String sql = "INSERT INTO " + table.name() + " (" + String.join(", ", columns) + ") VALUES ("
                + String.join(", ", exprs) + ") RETURNING " + table.pk() + "::text";
        return run(sql, params);
    }

    /** Updates the fields present in {@code values} on row {@code id}. */
    public static String update(String dataset, String id, Map<String, String> values) throws SQLException {
        Table table = table(dataset);
        List<String> sets = new ArrayList<>();
        List<String> params = new ArrayList<>();
        for (Field field : table.fields()) {
            if (!values.containsKey(field.key())) continue;
            String value = clean(values.get(field.key()));
            if (value == null && !field.optional()) throw new IllegalArgumentException("Field cannot be empty: " + field.key());
            sets.add(field.column() + " = " + field.expr());
            params.add(value);
        }
        if (sets.isEmpty()) throw new IllegalArgumentException("Nothing to update.");
        if (dataset.equals("inventory")) sets.add("updated_at = now()");
        params.add(id);
        String sql = "UPDATE " + table.name() + " SET " + String.join(", ", sets)
                + " WHERE " + table.pk() + " = ?::uuid RETURNING " + table.pk() + "::text";
        String result = run(sql, params);
        if (result == null) throw new IllegalArgumentException("No " + dataset + " row with id " + id);
        return result;
    }

    private static String run(String sql, List<String> params) throws SQLException {
        try (Connection c = PharmacyData.openConnection(); PreparedStatement st = c.prepareStatement(sql)) {
            for (int i = 0; i < params.size(); i++) st.setString(i + 1, params.get(i));
            try (ResultSet r = st.executeQuery()) {
                return r.next() ? r.getString(1) : null;
            }
        } catch (SQLException e) {
            // unknown branch/medicine code → the lookup yields NULL → NOT NULL violation; say it plainly
            if ("23502".equals(e.getSQLState())) throw new IllegalArgumentException("A required value is missing or a code does not exist: " + e.getMessage());
            if (e.getSQLState() != null && (e.getSQLState().startsWith("23") || e.getSQLState().startsWith("22")))
                throw new IllegalArgumentException(e.getMessage());
            throw e;
        } finally {
            PharmacyData.invalidate();
        }
    }

    private static Table table(String dataset) {
        Table table = TABLES.get(dataset);
        if (table == null) throw new IllegalArgumentException("Unknown collection: " + dataset);
        return table;
    }

    private static String clean(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
