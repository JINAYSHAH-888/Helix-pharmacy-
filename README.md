# Helixis distributed pharmacy control room

This is the integrated version of the supplied distributed-pharmacy RMI backend and the Helixis scroll-driven frontend.

The product opens on a live WebGL model of the six-node cluster (one persistent three.js canvas, see `scene/` and `engine/`), which follows the page through election, failover, vector clocks and a SHA-256 prescription chain, then becomes a read-only operational console for the distributed system:

- six pharmacy RMI nodes and the Mumbai router;
- live registry reachability and Bully coordinator visibility;
- medicines, prescriptions, inventory, dispensing ledger, and branch registry;
- routed search with local catalogue fallback;
- an interactive primary-backup fault-tolerance lab with failover, degraded writes, recovery, and replay evidence;
- an interactive data-consistency & replication lab (single-leader quorum model) with live write fan-out, quorum commit, quorum vs eventual reads, replication lag, and partition tolerance;
- database/schema map for the current in-memory model and reference PostgreSQL design;
- Lamport clocks, vector clocks, optimistic versioning, and idempotency explanations.

## Runtime requirements

- Java 17+
- A modern browser
- VS Code is recommended for editing and running the project

PostgreSQL 13+ is required: all pharmacy data lives in the `helixis_pharmacy` database (nothing is hard-coded in Java any more).

## Database (PostgreSQL)

One-time setup — creates the database and loads the schema plus seed rows from `sql/pharmacy_schema.sql`:

```bash
./scripts/db-setup.sh
```

`./scripts/db-setup.sh --reset` drops and reloads it. `./scripts/db-check.sh` (with the cluster and gateway running) proves the whole path end to end: row counts DB vs API, RMI nodes querying Postgres, and a live SQL update/insert/delete showing up in the API. The JDBC driver ships in `lib/`; every start script already has it on the classpath.

Connection settings (optional environment variables): `PHARMACY_DB_URL` (default `jdbc:postgresql://localhost:5432/helixis_pharmacy`), `PHARMACY_DB_USER` (default: your OS user), `PHARMACY_DB_PASSWORD`.

Edit data with plain SQL — the nodes and the control room pick it up within about two seconds:

```sql
-- psql -d helixis_pharmacy
UPDATE branch_inventory SET quantity_available = 7
 WHERE branch_id = (SELECT branch_id FROM pharmacy_branches WHERE branch_code = 'BR-DEL-01')
   AND medicine_id = (SELECT medicine_id FROM medicines WHERE medicine_code = 'MED-0001');

INSERT INTO medicines (medicine_code, name, generic_name, category, unit_of_measure, manufacturer)
VALUES ('MED-0016', 'Ibuprofen 400mg', 'Ibuprofen', 'NSAID', 'tablet', 'Cipla Ltd.');
```

## Run the complete project

Run `./scripts/db-setup.sh` once, then open two terminals in the project folder.

### Terminal 1 — six-node RMI cluster

```bash
./scripts/start-all.sh
```

This compiles the Java sources and starts Mumbai, Pune, Bengaluru, Delhi, Hyderabad, and Chennai. Runtime logs are written to `.runtime-logs/`.

### Terminal 2 — browser gateway and frontend

```bash
./scripts/start-web.sh
```

Open [http://localhost:8080](http://localhost:8080). The Java gateway serves the frontend and exposes the read-only API under `/api`.

To inspect the frontend without starting the RMI nodes, run only `./scripts/start-web.sh`. The interface will stay in catalog mode and the data remains readable.

## Gateway endpoints

| Endpoint | Purpose |
| --- | --- |
| `/api/health` | Gateway and RMI reachability check |
| `/api/overview` | Counts, sync health, and status distribution |
| `/api/network` | Six-node registry probes and coordinator candidate |
| `/api/branches` | Branch/node registry |
| `/api/medicines` | Shared medicine catalogue |
| `/api/prescriptions` | Prescription records |
| `/api/inventory` | Branch-local stock and vector clocks |
| `/api/transactions` | Dispensing ledger and idempotency keys |
| `/api/search?type=ANY&q=MED-0008` | Structured search plus RMI route trace |
| `/api/database` | Current collections and SQL reference map |
| `/api/fault-tolerance` | Current primary-backup simulation state and event log |
| `POST /api/fault-tolerance/action?action=...` | Bounded simulation action: `append`, `fail-primary`, `recover-primary`, or `reset` |

## Watch the fault-tolerance simulation

1. Start the RMI cluster and web gateway using the two terminals above.
2. Open [http://localhost:8080](http://localhost:8080) and choose **Fault lab** in the header, or open [http://localhost:8080/#fault-tolerance](http://localhost:8080/#fault-tolerance).
3. Click **Append test event**. The event log should show a `COMMITTED` record acknowledged by Mumbai and Pune.
4. Click **Fail Mumbai**. The phase changes to `DEGRADED`, the term increments, and Pune becomes **PROMOTED PRIMARY**.
5. Click **Append test event** again. The new event is accepted by Pune and marked `DEGRADED COMMIT`; the Mumbai acknowledgement is visibly pending.
6. Click **Recover Mumbai**. Mumbai rejoins as the backup, the missing event is replayed, and the lab returns to `SYNCED` without moving the active role back automatically.
7. Click **Reset lab** to return to the three seeded, fully replicated events.

The exact same sequence can be run from the terminal:

```bash
bash ./scripts/demo-fault-tolerance.sh
```

This is an ephemeral simulation held inside the Java gateway process. Restarting `start-web.sh` resets it. It does not write prescriptions, inventory, transactions, or anything else in PostgreSQL.

## Explore the consistency & replication lab

Choose **Consistency** in the header, or open [http://localhost:8080/#consistency](http://localhost:8080/#consistency). This lab is a self-contained, client-side model — it runs entirely in the browser and needs no gateway or RMI cluster, so it works even in catalog mode. It does not touch any pharmacy record.

It models single-leader replication across the six nodes (Mumbai is the leader):

1. **Write** a `key = value` on the leader. It is appended to the replication log with a monotonic version and fanned out to the five followers with per-node latency; each acknowledgement is logged.
2. A write **commits** once `W` replicas (the leader counts as one) acknowledge. In **Strong** mode a write that cannot reach `W` reachable replicas is refused to protect consistency.
3. **Read** with a quorum of `R` replicas (Strong) or from a single replica (Eventual). When `W + R > N` the read and write sets overlap, so a read is guaranteed **FRESH**; otherwise a read can return a **STALE** value while replication catches up.
4. **Click any follower to partition it.** It stops acknowledging, falls behind, and — on the next write — is shown holding a stale version; a partitioned node replays the log and rejoins in sync. **Reset model** restores the seed.

The verdict banner and the metrics row (leader version, committed writes, nodes in sync, max replication lag, stale reads) update live so the quorum trade-off is visible as you change `W`, `R`, and the consistency model.

## Project layout

```text
.
├── index.html                 # Scroll opening + control room UI
├── styles.css                 # Warm-white / black system interface
├── script.js                  # ScrollTrigger, data fetching, table + fault-lab + consistency-lab interactions
├── scene/ engine/ shaders/    # WebGL cluster scene (three.js) for the control room
├── landing/                   # Scroll-driven capsule landing page (React + three.js + GSAP)
├── src/com/pharmacy/rmi/      # Supplied RMI backend + HTTP gateway
├── scripts/                   # Compile, start cluster, start gateway, run fault demo
├── sql/pharmacy_schema.sql    # PostgreSQL schema + seed data (loaded by scripts/db-setup.sh)
├── lib/                       # PostgreSQL JDBC driver (42.7.4)
├── DESIGN.md                  # Durable visual/design context
├── ARCHITECTURE.md            # Runtime boundary, state, and verification notes
└── index.agent                # Machine-readable public page companion
```

## Important boundary

The pharmacy data gateway remains read-only: it does not mutate prescriptions, stock, or the dispensing ledger, and it does not create a second database. The only browser POST route is the explicitly labeled, in-memory fault-tolerance simulation. It exists to demonstrate primary-backup state transitions and resets when the gateway restarts; it is not a persistence adapter or a production consensus implementation.
