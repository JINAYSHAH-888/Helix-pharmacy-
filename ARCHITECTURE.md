# Helixis runtime architecture

## 1. Outcome and boundary

- **User outcome:** make the distributed pharmacy backend inspectable in a browser and let an operator observe a bounded primary-backup failover exercise without hiding node routing, health, or data semantics.
- **Durable mutations:** none. The supplied RMI application remains the only runtime source of the pharmacy dataset; the fault lab stores ephemeral simulation state in the gateway process only.
- **Explicit non-goals:** no pharmacy-record writes, no silent dispensing action, no fake PostgreSQL connection, no claim that the lab is a regulated production replication system or a full consensus implementation.
- **Deployment shape:** machine-shaped read model and observability adapter.
- **Why this shape:** every browser response is a projection of the PostgreSQL tables (read via `PharmacyData`, JDBC, 2 s cache) plus live local RMI registry probes. There is no model-selected transition or autonomous worker.

## 2. Trust roles

| Role | Identity | Authority | Must differ from |
| --- | --- | --- | --- |
| Contract proposer | Product/operator | Proposes future mutations | Ratifier |
| Contract ratifier | Not implemented | Must approve any future write contract | Proposer |
| Worker | RMI nodes / router | Search and return existing records | Result verifier |
| Result verifier | Browser gateway + independent runtime checks | Verifies response shape, reachability, and source | Worker |
| Operator | Human running the local project | Starts/stops nodes, runs the bounded fault lab, and inspects output | Automated gateway |

The frontend authorizes only four local simulation actions: append a synthetic event, fail the configured primary, recover it, and reset the lab. These actions cannot write to PostgreSQL or the pharmacy RMI mutation surface. Any future pharmacy write adapter must introduce explicit auth, an independent verifier, and an audit sink before adding controls to the UI.

## 3. State machine

- **Durable states:** none; both the supplied dataset and fault-lab state are process-local.
- **Observed gateway states:** `gateway-unavailable → catalog-only → rmi-live`; nodes expose declared status and a fresh reachability probe.
- **Fault-lab states:** `SYNCED → DEGRADED → CATCHING_UP → SYNCED`, with `PRIMARY_ACTIVE → BACKUP_PROMOTED` as the role transition.
- **Allowed fault transitions:** `append` while a replica is available; `fail-primary` increments the term and promotes Pune; `append` after failover creates a one-replica degraded commit; `recover-primary` replays missing events and re-joins Mumbai as backup; `reset` restores the seed.
- **Write-ahead decision record:** the synthetic event log is the simulation's evidence record; it is not durable storage.
- **Kill/resume rule:** browser refresh preserves the lab while the gateway process is alive; restarting the gateway resets it. No simulation action can dispense medicine.

## 4. Ports and adapters

| Port | Contract | Implementation | Failure behavior |
| --- | --- | --- | --- |
| RMI node | `PharmacyNode.search` | Supplied six-node Java RMI servers | Router marks failed nodes down and continues |
| RMI router | `PharmacyRouter.search` | Mumbai `PharmacyRouterImpl` | Search returns local catalogue projection if router is unavailable |
| HTTP gateway | JSON `GET /api/*` | `PharmacyWebServer` using JDK `HttpServer` | Returns controlled error; frontend remains usable as an empty shell |
| Fault lab | JSON `GET /api/fault-tolerance` + bounded `POST /api/fault-tolerance/action` | `PrimaryBackupSimulation` in the gateway process | Rejects unknown actions; state is ephemeral and isolated from pharmacy records |
| Static view | Same-origin asset delivery | Gateway serves project root safely | 404/403 for missing or escaped paths |
| Ground-truth view | Overview, network, collections, search | `ApiService` projections of the PostgreSQL tables and socket probes | Declared status remains visible beside effective reachability |
| Persistence | PostgreSQL (`helixis_pharmacy`) via JDBC | `PharmacyData` + `sql/pharmacy_schema.sql` | Serves the last good read through a brief outage; fails with a clear message if the database was never reachable |

## 5. Governance

- **Operator dial:** process start/stop plus the four explicitly labeled fault-lab simulation actions.
- **Contract ceiling:** simulation-only POSTs; pharmacy collections remain read-only.
- **Scoped verifier trust:** gateway responses are evidence of the local JVM and registry probes, not proof of external clinical correctness.
- **Reversibility rule:** `reset` is available for simulation state, and gateway restart is a full reset; no rollback claim is made for pharmacy data because it has no mutation route.
- **Irreversible human gate:** required before any future dispensing or prescription mutation.
- **Mutation-path inventory:** four bounded simulation transitions; no pharmacy-record mutation path.

## 6. Operational controls

- **Idempotency:** existing dispensing records expose `idempotency_key`; the browser never creates a new one.
- **Budgets:** gateway requests use a bounded browser fetch timeout; registry probes use a 150ms socket connect timeout.
- **Quarantine:** not applicable to read-only requests; failed probes are surfaced as `OFFLINE` rather than retried indefinitely.
- **Health sources:** gateway process, HTTP response, RMI registry reachability, declared branch status, and coordinator candidate.
- **Anomaly registry:** unreachable node, no coordinator, inventory `CONFLICT`/`FAILED`, low stock, and RMI router unavailable.

## 7. Evidence plan

- **Acceptance checks:** Java sources compile under Java 17; gateway serves `/api/health`; all collections return the expected counts; static asset paths cannot escape the project root; browser search renders local and routed states; the fault lab returns valid state after each action.
- **Chaos/replay fixtures:** stop one RMI node and confirm the UI surfaces the node as unreachable while the data explorer remains readable; run `fail-primary → append → recover-primary` and confirm term increment, Pune promotion, one-replica commit, and replay.
- **Gate traces:** the only POST path is `/api/fault-tolerance/action`; unknown actions return 400 and no pharmacy collection accepts POST.
- **Bypass negative tests:** browser has no POST/PUT/DELETE route; static handler rejects `..` path traversal.
- **Receipt verification:** not applicable to this read-only slice.
- **Claimed shape/level:** machine-shaped structural candidate; conformance is **UNSCORED** until runtime evidence is collected in an environment with Java 17 and the complete cluster.

## Creative strategy signal

- **Primary audience:** project reviewers, distributed-systems learners, and pharma-operations stakeholders who need to understand the system quickly.
- **Primary communication job:** within three seconds, show that one pharmacy search travels through a real six-node system and returns accountable records.
- **Primary message:** **One network. Six nodes. Every record accountable.**
- **Concept territory:** *The route is the product* — the capsule opens into the route, not a generic dashboard; every view keeps node origin, consistency state, and record identity visible.
- **Desired action:** inspect a collection, route a query, and understand why the record can be trusted.
