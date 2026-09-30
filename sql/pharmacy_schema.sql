-- ============================================================================
-- DISTRIBUTED PHARMACY PRESCRIPTION VERIFICATION SYSTEM
-- Relational schema (PostgreSQL 13+)
--
-- Each pharmacy branch = one node in the distributed system.
-- Design choices that map directly onto distributed-computing concepts:
--   1. UUID primary keys        -> nodes can generate IDs independently,
--                                  no central auto-increment coordinator needed.
--   2. idempotency_key          -> makes dispensing operations safe to retry
--                                  over an unreliable network (prevents the
--                                  exact duplicate-dispensing problem the
--                                  project is built to solve).
--   3. vector_clock (JSONB)     -> per-branch logical clocks on inventory,
--                                  used to detect and resolve conflicting
--                                  concurrent updates during replication.
--   4. sync_status columns      -> models eventual consistency: a row can be
--                                  correct locally but not yet replicated.
--   5. version (optimistic lock)-> prevents lost updates when two branches
--                                  try to update the same prescription state
--                                  independently before syncing.
--   6. prescription_hash        -> tamper-evident digital signature so a
--                                  prescription verified at Branch B can be
--                                  trusted even though it was issued at
--                                  Branch A.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------
CREATE TYPE node_status_enum AS ENUM
    ('ONLINE', 'OFFLINE', 'SYNCING', 'DEGRADED', 'MAINTENANCE');

CREATE TYPE prescription_status_enum AS ENUM
    ('PENDING', 'VERIFIED', 'PARTIALLY_DISPENSED', 'FULLY_DISPENSED',
     'EXPIRED', 'CANCELLED', 'FLAGGED_DUPLICATE');

CREATE TYPE inventory_sync_enum AS ENUM
    ('SYNCED', 'PENDING_SYNC', 'CONFLICT', 'FAILED');

CREATE TYPE dispensing_sync_enum AS ENUM
    ('LOCAL_ONLY', 'REPLICATED', 'CONFIRMED');


-- ============================================================================
-- TABLE 1: pharmacy_branches
-- The distributed node registry. Every branch is an autonomous node that
-- exposes a REST API and periodically reports a heartbeat.
-- ============================================================================
CREATE TABLE pharmacy_branches (
    branch_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_code         VARCHAR(10)   NOT NULL UNIQUE,          -- e.g. BR-DEL-01
    branch_name         VARCHAR(100)  NOT NULL,
    city                VARCHAR(50)   NOT NULL,
    state               VARCHAR(50)   NOT NULL,
    country             VARCHAR(50)   NOT NULL DEFAULT 'India',
    api_endpoint_url     VARCHAR(255)  NOT NULL UNIQUE,          -- REST endpoint of this node
    node_status         node_status_enum NOT NULL DEFAULT 'ONLINE',
    last_heartbeat_at    TIMESTAMPTZ,
    registered_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE pharmacy_branches IS 'Registry of independent pharmacy branch nodes in the distributed network.';
COMMENT ON COLUMN pharmacy_branches.node_status IS 'Live health state used by other nodes to decide whether to route verification/dispensing requests here.';


-- ============================================================================
-- TABLE 2: medicines
-- Shared master catalog. Logically replicated (read-mostly) across all nodes.
-- ============================================================================
CREATE TABLE medicines (
    medicine_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_code        VARCHAR(20)   NOT NULL UNIQUE,          -- e.g. MED-0007
    name                 VARCHAR(150)  NOT NULL,
    generic_name         VARCHAR(150)  NOT NULL,
    category             VARCHAR(60)   NOT NULL,
    is_controlled_substance BOOLEAN    NOT NULL DEFAULT FALSE,
    schedule_class       VARCHAR(15),                            -- e.g. Schedule II/III/IV, NULL if not controlled
    unit_of_measure      VARCHAR(20)   NOT NULL,                 -- tablet, capsule, ml, vial, inhaler
    manufacturer         VARCHAR(100)  NOT NULL,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT chk_schedule_requires_controlled
        CHECK (schedule_class IS NULL OR is_controlled_substance = TRUE)
);

COMMENT ON COLUMN medicines.is_controlled_substance IS 'Flags high-risk medicines (opioids, sedatives) that require stricter duplicate-dispensing checks.';


-- ============================================================================
-- TABLE 3: prescriptions
-- A digital prescription. Can be issued at one branch and verified/dispensed
-- at any other branch in the network, which is why it carries a tamper-
-- evident hash and an optimistic-concurrency version number.
-- ============================================================================
CREATE TABLE prescriptions (
    prescription_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_hash    VARCHAR(128)  NOT NULL UNIQUE,          -- SHA-256 digital signature for integrity verification
    patient_name         VARCHAR(100)  NOT NULL,
    patient_national_id   VARCHAR(30)   NOT NULL,                 -- e.g. Aadhaar / national ID for cross-branch duplicate detection
    doctor_name          VARCHAR(100)  NOT NULL,
    doctor_license_no     VARCHAR(30)   NOT NULL,
    issuing_branch_id     UUID          NOT NULL REFERENCES pharmacy_branches(branch_id) ON DELETE RESTRICT,
    medicine_id           UUID          NOT NULL REFERENCES medicines(medicine_id) ON DELETE RESTRICT,
    prescribed_quantity   INT           NOT NULL CHECK (prescribed_quantity > 0),
    dosage_instructions   TEXT,
    issue_date            DATE          NOT NULL,
    expiry_date           DATE          NOT NULL,
    status                prescription_status_enum NOT NULL DEFAULT 'PENDING',
    version               INT           NOT NULL DEFAULT 1,       -- optimistic concurrency control across nodes
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT chk_expiry_after_issue CHECK (expiry_date > issue_date)
);

COMMENT ON COLUMN prescriptions.prescription_hash IS 'Cryptographic hash of prescription contents; lets any branch verify authenticity without calling the issuing branch synchronously.';
COMMENT ON COLUMN prescriptions.version IS 'Bumped on every update; used to detect and resolve concurrent conflicting writes from different branches during sync.';

-- keep updated_at accurate on every write (small production touch)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prescriptions_updated_at
    BEFORE UPDATE ON prescriptions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- TABLE 4: branch_inventory
-- Each branch's LOCAL view of stock. This is the replicated/eventually-
-- consistent piece of the system: every node can update its own row
-- immediately, and vector_clock + sync_status let the replication layer
-- detect conflicts when merging state across nodes.
-- ============================================================================
CREATE TABLE branch_inventory (
    inventory_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id             UUID          NOT NULL REFERENCES pharmacy_branches(branch_id) ON DELETE CASCADE,
    medicine_id           UUID          NOT NULL REFERENCES medicines(medicine_id) ON DELETE RESTRICT,
    quantity_available     INT           NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
    reorder_threshold      INT           NOT NULL DEFAULT 10 CHECK (reorder_threshold >= 0),
    vector_clock          JSONB         NOT NULL DEFAULT '{}',   -- e.g. {"BR-DEL-01": 4, "BR-MUM-02": 2}
    sync_status           inventory_sync_enum NOT NULL DEFAULT 'SYNCED',
    last_synced_at         TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT uq_branch_medicine UNIQUE (branch_id, medicine_id)
);

COMMENT ON COLUMN branch_inventory.vector_clock IS 'Per-node logical clock snapshot; used to detect concurrent conflicting stock updates during replication (classic vector clock pattern).';


-- ============================================================================
-- TABLE 5: dispensing_transactions
-- The core anti-duplicate-dispensing ledger. The idempotency_key is the
-- single most important column in the whole schema: even if a pharmacist's
-- request is retried (network timeout, node failover) or two branches race
-- to dispense the same prescription, the UNIQUE constraint guarantees the
-- medicine is only ever dispensed once for that logical action.
-- ============================================================================
CREATE TABLE dispensing_transactions (
    transaction_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id        UUID          NOT NULL REFERENCES prescriptions(prescription_id) ON DELETE RESTRICT,
    dispensing_branch_id    UUID          NOT NULL REFERENCES pharmacy_branches(branch_id) ON DELETE RESTRICT,
    pharmacist_name         VARCHAR(100)  NOT NULL,
    pharmacist_license_no    VARCHAR(30)   NOT NULL,
    quantity_dispensed       INT           NOT NULL CHECK (quantity_dispensed > 0),
    idempotency_key          VARCHAR(64)   NOT NULL UNIQUE,       -- e.g. DISP-BR01-20260610-0001
    dispensed_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    sync_status              dispensing_sync_enum NOT NULL DEFAULT 'LOCAL_ONLY'
);

COMMENT ON COLUMN dispensing_transactions.idempotency_key IS 'Guarantees exactly-once dispensing semantics across an unreliable distributed network; this is the primary duplicate-dispensing safeguard.';


-- ----------------------------------------------------------------------------
-- INDEXES (query patterns a real dispensing/verification API would hit hard)
-- ----------------------------------------------------------------------------
CREATE INDEX idx_prescriptions_status          ON prescriptions(status);
CREATE INDEX idx_prescriptions_patient_id       ON prescriptions(patient_national_id);
CREATE INDEX idx_prescriptions_medicine         ON prescriptions(medicine_id);
CREATE INDEX idx_branch_inventory_medicine      ON branch_inventory(medicine_id);
CREATE INDEX idx_branch_inventory_sync_status    ON branch_inventory(sync_status);
CREATE INDEX idx_dispensing_prescription        ON dispensing_transactions(prescription_id);
CREATE INDEX idx_dispensing_branch              ON dispensing_transactions(dispensing_branch_id);


-- ============================================================================
-- SAMPLE DATA
-- ============================================================================

-- ---------------------------------------------------------------
-- 1. BRANCHES (6 nodes)
-- ---------------------------------------------------------------
INSERT INTO pharmacy_branches (branch_id, branch_code, branch_name, city, state, country, api_endpoint_url, node_status, last_heartbeat_at, registered_at) VALUES
('a1000000-0000-0000-0000-000000000001', 'BR-DEL-01', 'MedPlus Central Pharmacy',            'New Delhi',  'Delhi',       'India', 'https://branch-del01.pharmacynet.local/api/v1', 'ONLINE',    now() - INTERVAL '2 minutes',  now() - INTERVAL '400 days'),
('a1000000-0000-0000-0000-000000000002', 'BR-MUM-02', 'Apollo Pharmacy Andheri',             'Mumbai',     'Maharashtra', 'India', 'https://branch-mum02.pharmacynet.local/api/v1', 'ONLINE',    now() - INTERVAL '1 minutes',  now() - INTERVAL '380 days'),
('a1000000-0000-0000-0000-000000000003', 'BR-BLR-03', 'Wellness Forever Koramangala',        'Bengaluru',  'Karnataka',   'India', 'https://branch-blr03.pharmacynet.local/api/v1', 'SYNCING',   now() - INTERVAL '6 minutes',  now() - INTERVAL '360 days'),
('a1000000-0000-0000-0000-000000000004', 'BR-HYD-04', 'MedLife Pharmacy HITEC City',         'Hyderabad',  'Telangana',   'India', 'https://branch-hyd04.pharmacynet.local/api/v1', 'ONLINE',    now() - INTERVAL '3 minutes',  now() - INTERVAL '300 days'),
('a1000000-0000-0000-0000-000000000005', 'BR-CHN-05', 'Netmeds Express T Nagar',             'Chennai',    'Tamil Nadu',  'India', 'https://branch-chn05.pharmacynet.local/api/v1', 'DEGRADED',  now() - INTERVAL '25 minutes', now() - INTERVAL '250 days'),
('a1000000-0000-0000-0000-000000000006', 'BR-PUN-06', 'Generic Aadhaar Pharmacy Kothrud',    'Pune',       'Maharashtra', 'India', 'https://branch-pun06.pharmacynet.local/api/v1', 'OFFLINE',   now() - INTERVAL '3 hours',    now() - INTERVAL '200 days');

-- ---------------------------------------------------------------
-- 2. MEDICINES (15 items, mix of regular + controlled substances)
-- ---------------------------------------------------------------
INSERT INTO medicines (medicine_id, medicine_code, name, generic_name, category, is_controlled_substance, schedule_class, unit_of_measure, manufacturer) VALUES
('a2000000-0000-0000-0000-000000000001', 'MED-0001', 'Paracetamol 500mg',      'Acetaminophen',  'Analgesic',           FALSE, NULL,             'tablet',   'Cipla Ltd.'),
('a2000000-0000-0000-0000-000000000002', 'MED-0002', 'Amoxicillin 250mg',      'Amoxicillin',    'Antibiotic',          FALSE, NULL,             'capsule',  'Sun Pharma'),
('a2000000-0000-0000-0000-000000000003', 'MED-0003', 'Azithromycin 500mg',     'Azithromycin',   'Antibiotic',          FALSE, NULL,             'tablet',   'Zydus Cadila'),
('a2000000-0000-0000-0000-000000000004', 'MED-0004', 'Metformin 500mg',        'Metformin HCl',  'Antidiabetic',        FALSE, NULL,             'tablet',   'Dr. Reddy''s'),
('a2000000-0000-0000-0000-000000000005', 'MED-0005', 'Atorvastatin 10mg',      'Atorvastatin',   'Statin',              FALSE, NULL,             'tablet',   'Lupin Ltd.'),
('a2000000-0000-0000-0000-000000000006', 'MED-0006', 'Omeprazole 20mg',        'Omeprazole',     'PPI / Antacid',       FALSE, NULL,             'capsule',  'Cipla Ltd.'),
('a2000000-0000-0000-0000-000000000007', 'MED-0007', 'Alprazolam 0.5mg',       'Alprazolam',     'Anxiolytic',          TRUE,  'Schedule IV',    'tablet',   'Sun Pharma'),
('a2000000-0000-0000-0000-000000000008', 'MED-0008', 'Tramadol 50mg',          'Tramadol HCl',   'Opioid Analgesic',    TRUE,  'Schedule IV',    'capsule',  'Abbott India'),
('a2000000-0000-0000-0000-000000000009', 'MED-0009', 'Oxycodone 10mg',         'Oxycodone HCl',  'Opioid Analgesic',    TRUE,  'Schedule II',    'tablet',   'Mundipharma'),
('a2000000-0000-0000-0000-000000000010', 'MED-0010', 'Cetirizine 10mg',        'Cetirizine',     'Antihistamine',       FALSE, NULL,             'tablet',   'GSK'),
('a2000000-0000-0000-0000-000000000011', 'MED-0011', 'Insulin Glargine',       'Insulin Glargine','Antidiabetic',       FALSE, NULL,             'vial',     'Sanofi India'),
('a2000000-0000-0000-0000-000000000012', 'MED-0012', 'Amlodipine 5mg',         'Amlodipine',     'Antihypertensive',    FALSE, NULL,             'tablet',   'Zydus Cadila'),
('a2000000-0000-0000-0000-000000000013', 'MED-0013', 'Diazepam 5mg',           'Diazepam',       'Sedative',            TRUE,  'Schedule IV',    'tablet',   'Ranbaxy'),
('a2000000-0000-0000-0000-000000000014', 'MED-0014', 'Salbutamol Inhaler',     'Salbutamol',     'Bronchodilator',      FALSE, NULL,             'inhaler',  'Cipla Ltd.'),
('a2000000-0000-0000-0000-000000000015', 'MED-0015', 'Codeine Phosphate 30mg', 'Codeine',        'Opioid Analgesic',    TRUE,  'Schedule III',   'tablet',   'Abbott India');

-- ---------------------------------------------------------------
-- 3. PRESCRIPTIONS (20 records, spread across branches/statuses)
-- ---------------------------------------------------------------
INSERT INTO prescriptions (prescription_id, prescription_hash, patient_name, patient_national_id, doctor_name, doctor_license_no, issuing_branch_id, medicine_id, prescribed_quantity, dosage_instructions, issue_date, expiry_date, status) VALUES
('a3000000-0000-0000-0000-000000000001', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85', 'Rohan Mehta',     'ID-3345-9981', 'Dr. Kavita Singh',   'LIC-DOC-1021', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000007', 30, '1 tablet at night for 30 days',       '2026-06-01', '2026-09-01', 'VERIFIED'),
('a3000000-0000-0000-0000-000000000002', '7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730', 'Ayesha Khan',     'ID-2210-4471', 'Dr. Rajesh Nair',    'LIC-DOC-1054', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 20, '1 tablet twice daily after food',    '2026-05-20', '2026-08-20', 'FULLY_DISPENSED'),
('a3000000-0000-0000-0000-000000000003', '2c624232cdd221771294dfbb310aca000a0df6ac8b66b696d90ef06fdefb64a3', 'Vikram Rao',      'ID-8890-1123', 'Dr. Neha Gupta',     'LIC-DOC-1102', 'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000009', 15, '1 tablet every 6 hours as needed',   '2026-06-10', '2026-07-10', 'FLAGGED_DUPLICATE'),
('a3000000-0000-0000-0000-000000000004', '19581e27de7ced00ff1ce50b2047e7a567c76b1cbaebabe5ef03f7c3017b1d1', 'Sanjana Iyer',    'ID-4471-2290', 'Dr. Arjun Malhotra', 'LIC-DOC-1077', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 21, '1 capsule thrice daily for 7 days',  '2026-07-01', '2026-08-01', 'PENDING'),
('a3000000-0000-0000-0000-000000000005', '3fdba35f04dc8c462986c992bcf875546257113072a909c162f7e470e581e278', 'Karan Verma',     'ID-1123-7788', 'Dr. Priya Sharma',   'LIC-DOC-1033', 'a1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000011', 5,  '10 units subcutaneous every morning','2026-06-15', '2026-12-15', 'VERIFIED'),
('a3000000-0000-0000-0000-000000000006', '58157b151a1350e7f9fa35331cb8474e34578ce9a0e33e10cd4ce70b1224eb9d', 'Meera Pillai',    'ID-9982-3345', 'Dr. Kavita Singh',   'LIC-DOC-1021', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000005', 30, '1 tablet at night',                  '2026-05-05', '2026-11-05', 'FULLY_DISPENSED'),
('a3000000-0000-0000-0000-000000000007', '252f10c83610ebca1a059c0bae8255eba2f95be4d1d7bcfa89d7248a82d9f11', 'Arjun Nair',      'ID-6612-8890', 'Dr. Sameer Joshi',   'LIC-DOC-1088', 'a1000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000008', 20, '1 capsule every 8 hours as needed',  '2026-06-20', '2026-07-20', 'PARTIALLY_DISPENSED'),
('a3000000-0000-0000-0000-000000000008', 'd0e4dd6bbf29ffea1c9c68c14d1a8f4f52e6b5db3a06c1c1e6b7b74f7b7e8a1b', 'Divya Krishnan',  'ID-7789-4456', 'Dr. Neha Gupta',     'LIC-DOC-1102', 'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000006', 14, '1 capsule before breakfast',         '2026-07-02', '2026-08-02', 'VERIFIED'),
('a3000000-0000-0000-0000-000000000009', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', 'Farhan Ali',      'ID-3321-9087', 'Dr. Arjun Malhotra', 'LIC-DOC-1077', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000013', 10, '1 tablet at bedtime for 10 days',    '2026-06-25', '2026-07-25', 'VERIFIED'),
('a3000000-0000-0000-0000-000000000010', '1c3b52c40e368c66de1d17b26e6c48c95a4b64af0f6f9c85c6a6d3b1d3ea9c3', 'Priya Nair',      'ID-5567-1290', 'Dr. Rajesh Nair',    'LIC-DOC-1054', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000010', 10, '1 tablet daily for allergy',         '2026-07-05', '2026-08-05', 'PENDING'),
('a3000000-0000-0000-0000-000000000011', '4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce', 'Aditya Kulkarni', 'ID-8834-2201', 'Dr. Sameer Joshi',   'LIC-DOC-1088', 'a1000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000012', 30, '1 tablet daily in the morning',      '2026-05-28', '2026-11-28', 'VERIFIED'),
('a3000000-0000-0000-0000-000000000012', '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b', 'Neha Bhatt',      'ID-2298-7712', 'Dr. Priya Sharma',   'LIC-DOC-1033', 'a1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000003', 12, '1 tablet daily for 6 days',          '2026-07-08', '2026-08-08', 'VERIFIED'),
('a3000000-0000-0000-0000-000000000013', 'd4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35', 'Yash Thakur',     'ID-7734-6621', 'Dr. Kavita Singh',   'LIC-DOC-1021', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000009', 15, '1 tablet every 6 hours as needed',   '2026-06-10', '2026-07-10', 'FLAGGED_DUPLICATE'),
('a3000000-0000-0000-0000-000000000014', '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a', 'Ritika Shah',     'ID-9911-3344', 'Dr. Neha Gupta',     'LIC-DOC-1102', 'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000014', 1,  '2 puffs as needed for wheezing',     '2026-06-30', '2026-12-30', 'VERIFIED'),
('a3000000-0000-0000-0000-000000000015', 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d', 'Manish Gupta',    'ID-4432-8871', 'Dr. Arjun Malhotra', 'LIC-DOC-1077', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000015', 12, '1 tablet every 6 hours as needed',   '2026-06-18', '2026-07-18', 'PARTIALLY_DISPENSED'),
('a3000000-0000-0000-0000-000000000016', 'e7f6c011776e8db7cd330b54174fd76f7d0216b612387a5ffcfb81e6f0919683', 'Simran Kaur',     'ID-6690-1123', 'Dr. Sameer Joshi',   'LIC-DOC-1088', 'a1000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000004', 30, '1 tablet twice daily',               '2026-05-15', '2026-11-15', 'FULLY_DISPENSED'),
('a3000000-0000-0000-0000-000000000017', 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d1dc058c2cb4750fc22ce6c47', 'Dev Chauhan',     'ID-1187-5523', 'Dr. Rajesh Nair',    'LIC-DOC-1054', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000005', 30, '1 tablet at night',                  '2026-07-01', '2027-01-01', 'PENDING'),
('a3000000-0000-0000-0000-000000000018', '1f3870be274f6c49b3e31a0c6728957f7de1e08c40deda65694793903b1f81e2', 'Tanvi Deshmukh',  'ID-5543-9902', 'Dr. Kavita Singh',   'LIC-DOC-1021', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 21, '1 capsule thrice daily for 7 days',  '2026-06-22', '2026-07-22', 'VERIFIED'),
('a3000000-0000-0000-0000-000000000019', '2b4c303c9a4c4bfc5e2e4c7e9b5f2f9a1b8b04f0dfc79b8b3a3f37bc6f6b1e5c', 'Om Prakash',      'ID-7761-4432', 'Dr. Priya Sharma',   'LIC-DOC-1033', 'a1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000007', 30, '1 tablet at night for 30 days',      '2026-06-05', '2026-09-05', 'VERIFIED'),
('a3000000-0000-0000-0000-000000000020', '3c9909afec25354d551dae21590bb26e38d53f2173b8d3dc3eee4c047e7ab1c1', 'Ishita Bose',     'ID-2287-6612', 'Dr. Neha Gupta',     'LIC-DOC-1102', 'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 20, '1 tablet twice daily after food',    '2026-01-01', '2026-02-01', 'EXPIRED');

-- ---------------------------------------------------------------
-- 4. BRANCH_INVENTORY (per-node stock levels + replication metadata)
-- ---------------------------------------------------------------
INSERT INTO branch_inventory (inventory_id, branch_id, medicine_id, quantity_available, reorder_threshold, vector_clock, sync_status, last_synced_at) VALUES
('a4000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 480, 50, '{"BR-DEL-01": 12}',                    'SYNCED',       now() - INTERVAL '5 minutes'),
('a4000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 120, 30, '{"BR-DEL-01": 8}',                     'SYNCED',       now() - INTERVAL '5 minutes'),
('a4000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000007', 40,  15, '{"BR-DEL-01": 4}',                     'SYNCED',       now() - INTERVAL '5 minutes'),
('a4000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000009', 8,   10, '{"BR-DEL-01": 6, "BR-BLR-03": 2}',      'CONFLICT',     now() - INTERVAL '2 hours'),
('a4000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000013', 25,  10, '{"BR-DEL-01": 3}',                     'SYNCED',       now() - INTERVAL '10 minutes'),
('a4000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 300, 50, '{"BR-MUM-02": 9}',                     'SYNCED',       now() - INTERVAL '3 minutes'),
('a4000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000004', 150, 30, '{"BR-MUM-02": 5}',                     'SYNCED',       now() - INTERVAL '3 minutes'),
('a4000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000005', 90,  20, '{"BR-MUM-02": 7}',                     'SYNCED',       now() - INTERVAL '3 minutes'),
('a4000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000008', 18,  15, '{"BR-MUM-02": 2}',                     'PENDING_SYNC', now() - INTERVAL '40 minutes'),
('a4000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000015', 12,  10, '{"BR-MUM-02": 1}',                     'PENDING_SYNC', now() - INTERVAL '40 minutes'),
('a4000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 210, 50, '{"BR-BLR-03": 6}',                     'SYNCED',       now() - INTERVAL '8 minutes'),
('a4000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000003', 65,  20, '{"BR-BLR-03": 4}',                     'SYNCED',       now() - INTERVAL '8 minutes'),
('a4000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000006', 44,  15, '{"BR-BLR-03": 3}',                     'SYNCED',       now() - INTERVAL '8 minutes'),
('a4000000-0000-0000-0000-000000000014', 'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000009', 6,   10, '{"BR-DEL-01": 6, "BR-BLR-03": 2}',      'CONFLICT',     now() - INTERVAL '2 hours'),
('a4000000-0000-0000-0000-000000000015', 'a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000014', 55,  10, '{"BR-BLR-03": 5}',                     'SYNCED',       now() - INTERVAL '8 minutes'),
('a4000000-0000-0000-0000-000000000016', 'a1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002', 95,  30, '{"BR-HYD-04": 5}',                     'SYNCED',       now() - INTERVAL '4 minutes'),
('a4000000-0000-0000-0000-000000000017', 'a1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000005', 70,  20, '{"BR-HYD-04": 4}',                     'SYNCED',       now() - INTERVAL '4 minutes'),
('a4000000-0000-0000-0000-000000000018', 'a1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000011', 22,  10, '{"BR-HYD-04": 3}',                     'SYNCED',       now() - INTERVAL '4 minutes'),
('a4000000-0000-0000-0000-000000000019', 'a1000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000007', 33,  15, '{"BR-HYD-04": 2}',                     'SYNCED',       now() - INTERVAL '4 minutes'),
('a4000000-0000-0000-0000-000000000020', 'a1000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000001', 140, 50, '{"BR-CHN-05": 3}',                     'PENDING_SYNC', now() - INTERVAL '1 hour'),
('a4000000-0000-0000-0000-000000000021', 'a1000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000008', 5,   15, '{"BR-CHN-05": 1}',                     'PENDING_SYNC', now() - INTERVAL '1 hour'),
('a4000000-0000-0000-0000-000000000022', 'a1000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000010', 60,  20, '{"BR-CHN-05": 4}',                     'PENDING_SYNC', now() - INTERVAL '1 hour'),
('a4000000-0000-0000-0000-000000000023', 'a1000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000012', 0,   10, '{"BR-PUN-06": 0}',                     'FAILED',       now() - INTERVAL '3 hours'),
('a4000000-0000-0000-0000-000000000024', 'a1000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000004', 15,  30, '{"BR-PUN-06": 1}',                     'FAILED',       now() - INTERVAL '3 hours');

-- ---------------------------------------------------------------
-- 5. DISPENSING_TRANSACTIONS
-- Note rows 3 and 13 in `prescriptions` share the same patient national ID
-- and medicine (Oxycodone) across two different branches (DEL-01 and
-- BLR-03) within the prescription's validity window -- exactly the
-- cross-branch duplicate-dispensing scenario this system exists to catch.
-- Branch BLR-03 dispensed first; branch DEL-01's later request is blocked
-- by the application layer BEFORE an insert is attempted here, which is
-- why only ONE of the two prescriptions has a corresponding transaction.
-- ---------------------------------------------------------------
INSERT INTO dispensing_transactions (transaction_id, prescription_id, dispensing_branch_id, pharmacist_name, pharmacist_license_no, quantity_dispensed, idempotency_key, dispensed_at, sync_status) VALUES
('a5000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'Anita Deshpande', 'PHM-LIC-2201', 20, 'DISP-BR02-20260521-0001', '2026-05-21 10:15:00+05:30', 'CONFIRMED'),
('a5000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', 'Suresh Kumar',    'PHM-LIC-2244', 15, 'DISP-BR03-20260610-0007', '2026-06-10 14:42:00+05:30', 'CONFIRMED'),
('a5000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000002', 'Anita Deshpande', 'PHM-LIC-2201', 30, 'DISP-BR02-20260506-0002', '2026-05-06 09:05:00+05:30', 'CONFIRMED'),
('a5000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000005', 'Ganesh Iyer',     'PHM-LIC-2278', 10, 'DISP-BR05-20260621-0003', '2026-06-21 16:30:00+05:30', 'REPLICATED'),
('a5000000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000001', 'Ritu Bansal',     'PHM-LIC-2111', 10, 'DISP-BR01-20260626-0004', '2026-06-26 11:20:00+05:30', 'CONFIRMED'),
('a5000000-0000-0000-0000-000000000006', 'a3000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000006', 'Pooja Rane',      'PHM-LIC-2309', 30, 'DISP-BR06-20260529-0001', '2026-05-29 08:50:00+05:30', 'CONFIRMED'),
('a5000000-0000-0000-0000-000000000007', 'a3000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000004', 'Kiran Reddy',     'PHM-LIC-2155', 12, 'DISP-BR04-20260709-0002', '2026-07-09 13:10:00+05:30', 'CONFIRMED'),
('a5000000-0000-0000-0000-000000000008', 'a3000000-0000-0000-0000-000000000014', 'a1000000-0000-0000-0000-000000000003', 'Suresh Kumar',    'PHM-LIC-2244', 1,  'DISP-BR03-20260701-0008', '2026-07-01 17:00:00+05:30', 'CONFIRMED'),
('a5000000-0000-0000-0000-000000000009', 'a3000000-0000-0000-0000-000000000015', 'a1000000-0000-0000-0000-000000000002', 'Anita Deshpande', 'PHM-LIC-2201', 6,  'DISP-BR02-20260619-0003', '2026-06-19 12:25:00+05:30', 'REPLICATED'),
('a5000000-0000-0000-0000-000000000010', 'a3000000-0000-0000-0000-000000000016', 'a1000000-0000-0000-0000-000000000005', 'Ganesh Iyer',     'PHM-LIC-2278', 30, 'DISP-BR05-20260516-0002', '2026-05-16 09:40:00+05:30', 'CONFIRMED'),
('a5000000-0000-0000-0000-000000000011', 'a3000000-0000-0000-0000-000000000018', 'a1000000-0000-0000-0000-000000000001', 'Ritu Bansal',     'PHM-LIC-2111', 21, 'DISP-BR01-20260623-0005', '2026-06-23 15:55:00+05:30', 'LOCAL_ONLY'),
('a5000000-0000-0000-0000-000000000012', 'a3000000-0000-0000-0000-000000000019', 'a1000000-0000-0000-0000-000000000004', 'Kiran Reddy',     'PHM-LIC-2155', 30, 'DISP-BR04-20260606-0003', '2026-06-06 10:00:00+05:30', 'CONFIRMED');


-- ============================================================================
-- EXAMPLE: this is exactly the query the "prevent duplicate dispensing"
-- feature runs before allowing a new dispensing_transactions insert.
-- Any prescription showing a hit here should be rejected / flagged.
-- ============================================================================
-- SELECT p.prescription_id, p.patient_national_id, p.medicine_id, d.dispensing_branch_id, d.dispensed_at
-- FROM prescriptions p
-- JOIN dispensing_transactions d ON d.prescription_id = p.prescription_id
-- WHERE p.patient_national_id = :incoming_patient_id
--   AND p.medicine_id = :incoming_medicine_id
--   AND p.status IN ('FULLY_DISPENSED', 'PARTIALLY_DISPENSED');