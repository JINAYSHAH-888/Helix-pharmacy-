package com.pharmacy.rmi.server;

import com.pharmacy.rmi.model.*;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

/**
 * The pharmacy dataset, read from PostgreSQL (replaces the old HardcodedData class).
 *
 * Every RMI node and the HTTP gateway call these accessors. Results are cached for
 * {@link #TTL_MS} so a burst of requests costs one round-trip, while a change made with
 * plain SQL (psql, pgAdmin, …) shows up in the API within a couple of seconds.
 *
 * Connection settings (environment variables, all optional):
 *   PHARMACY_DB_URL       default jdbc:postgresql://localhost:5432/helixis_pharmacy
 *   PHARMACY_DB_USER      default: the OS user (Postgres.app / Homebrew default role)
 *   PHARMACY_DB_PASSWORD  default: empty
 * The same keys are also accepted as JVM system properties (-Dpharmacy.db.url=…).
 */
public final class PharmacyData {
    private PharmacyData() {}

    private static final long TTL_MS = 2_000;

    private record Snapshot(List<PharmacyBranch> branches, List<Medicine> medicines,
                            List<Prescription> prescriptions, List<Inventory> inventory,
                            List<DispensingTransaction> transactions, long loadedAt) {}

    private static volatile Snapshot snapshot;

    public static List<PharmacyBranch> branches() { return current().branches(); }
    public static List<Medicine> medicines() { return current().medicines(); }
    public static List<Prescription> prescriptions() { return current().prescriptions(); }
    public static List<Inventory> inventory() { return current().inventory(); }
    public static List<DispensingTransaction> transactions() { return current().transactions(); }

    public static PharmacyBranch branchById(String id) {
        return branches().stream().filter(x -> x.id().equals(id)).findFirst().orElse(null);
    }

    public static PharmacyBranch branchByCode(String code) {
        return branches().stream().filter(x -> x.code().equals(code)).findFirst().orElse(null);
    }

    public static Medicine medicineById(String id) {
        return medicines().stream().filter(x -> x.id().equals(id)).findFirst().orElse(null);
    }

    /** Where the data comes from — shown by the gateway so the UI never guesses. */
    public static String describeSource() {
        return setting("PHARMACY_DB_URL", "pharmacy.db.url", "jdbc:postgresql://localhost:5432/helixis_pharmacy");
    }

    private static Snapshot current() {
        Snapshot s = snapshot;
        if (s != null && System.currentTimeMillis() - s.loadedAt() < TTL_MS) return s;
        synchronized (PharmacyData.class) {
            s = snapshot;
            if (s != null && System.currentTimeMillis() - s.loadedAt() < TTL_MS) return s;
            try {
                snapshot = load();
            } catch (SQLException e) {
                if (s != null) return s;   // keep serving the last good read through a brief outage
                throw new IllegalStateException("PostgreSQL unavailable at " + describeSource()
                        + " — run ./scripts/db-setup.sh, or set PHARMACY_DB_URL. Cause: " + e.getMessage(), e);
            }
            return snapshot;
        }
    }

    private static Snapshot load() throws SQLException {
        try (Connection c = connect(); Statement st = c.createStatement()) {
            List<PharmacyBranch> branches = new ArrayList<>();
            try (ResultSet r = st.executeQuery("""
                    SELECT branch_id::text, branch_code, branch_name, city, state, node_status::text
                    FROM pharmacy_branches ORDER BY branch_id""")) {
                while (r.next()) branches.add(new PharmacyBranch(r.getString(1), r.getString(2), r.getString(3),
                        r.getString(4), r.getString(5), r.getString(6)));
            }
            List<Medicine> medicines = new ArrayList<>();
            try (ResultSet r = st.executeQuery("""
                    SELECT medicine_id::text, medicine_code, name, generic_name, category,
                           is_controlled_substance, schedule_class, unit_of_measure, manufacturer
                    FROM medicines ORDER BY medicine_code""")) {
                while (r.next()) medicines.add(new Medicine(r.getString(1), r.getString(2), r.getString(3),
                        r.getString(4), r.getString(5), r.getBoolean(6), r.getString(7), r.getString(8), r.getString(9)));
            }
            List<Prescription> prescriptions = new ArrayList<>();
            try (ResultSet r = st.executeQuery("""
                    SELECT prescription_id::text, prescription_hash, patient_name, patient_national_id,
                           doctor_name, doctor_license_no, issuing_branch_id::text, medicine_id::text,
                           prescribed_quantity, dosage_instructions, issue_date::text, expiry_date::text, status::text
                    FROM prescriptions ORDER BY prescription_id""")) {
                while (r.next()) prescriptions.add(new Prescription(r.getString(1), r.getString(2), r.getString(3),
                        r.getString(4), r.getString(5), r.getString(6), r.getString(7), r.getString(8), r.getInt(9),
                        r.getString(10), r.getString(11), r.getString(12), r.getString(13)));
            }
            List<Inventory> inventory = new ArrayList<>();
            try (ResultSet r = st.executeQuery("""
                    SELECT inventory_id::text, branch_id::text, medicine_id::text, quantity_available,
                           reorder_threshold, vector_clock::text, sync_status::text
                    FROM branch_inventory ORDER BY inventory_id""")) {
                while (r.next()) inventory.add(new Inventory(r.getString(1), r.getString(2), r.getString(3),
                        r.getInt(4), r.getInt(5), r.getString(6), r.getString(7)));
            }
            List<DispensingTransaction> transactions = new ArrayList<>();
            try (ResultSet r = st.executeQuery("""
                    SELECT transaction_id::text, prescription_id::text, dispensing_branch_id::text,
                           pharmacist_name, pharmacist_license_no, quantity_dispensed, idempotency_key,
                           to_char(dispensed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') || '+05:30',
                           sync_status::text
                    FROM dispensing_transactions ORDER BY transaction_id""")) {
                while (r.next()) transactions.add(new DispensingTransaction(r.getString(1), r.getString(2), r.getString(3),
                        r.getString(4), r.getString(5), r.getInt(6), r.getString(7), r.getString(8), r.getString(9)));
            }
            return new Snapshot(List.copyOf(branches), List.copyOf(medicines), List.copyOf(prescriptions),
                    List.copyOf(inventory), List.copyOf(transactions), System.currentTimeMillis());
        }
    }

    /** A fresh JDBC connection for writers (the gateway's add/update endpoints). */
    public static Connection openConnection() throws SQLException { return connect(); }

    /** Drop the cached snapshot so the next read sees a write immediately. */
    public static void invalidate() { snapshot = null; }

    private static Connection connect() throws SQLException {
        Properties props = new Properties();
        props.setProperty("user", setting("PHARMACY_DB_USER", "pharmacy.db.user", System.getProperty("user.name")));
        props.setProperty("password", setting("PHARMACY_DB_PASSWORD", "pharmacy.db.password", ""));
        props.setProperty("connectTimeout", "3");
        props.setProperty("ApplicationName", "helixis");
        return DriverManager.getConnection(describeSource(), props);
    }

    private static String setting(String env, String prop, String fallback) {
        String v = System.getProperty(prop);
        if (v == null || v.isBlank()) v = System.getenv(env);
        return v == null || v.isBlank() ? fallback : v;
    }
}
