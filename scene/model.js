/**
 * System model — pure logic, no THREE. Everything the scene shows is derived
 * from here, and everything here is either read from the Java gateway (LIVE)
 * or a labelled client-side model of a protocol the backend implements (MODEL).
 */

/* Mirrors BullyElectionDemo.java / PharmacyWebServer NodeDefinition: ID = bully priority. */
export const NODES = [
  { id: 1, name: "Mumbai", code: "MUM", branch: "BR-MUM-02", port: 1099 },
  { id: 2, name: "Pune", code: "PUN", branch: "BR-PUN-06", port: 1100 },
  { id: 3, name: "Bengaluru", code: "BLR", branch: "BR-BLR-03", port: 1101 },
  { id: 4, name: "Delhi", code: "DEL", branch: "BR-DEL-01", port: 1102 },
  { id: 5, name: "Hyderabad", code: "HYD", branch: "BR-HYD-04", port: 1103 },
  { id: 6, name: "Chennai", code: "CHN", branch: "BR-CHN-05", port: 1104 },
];
export const byBranch = (code) => NODES.findIndex((n) => n.branch === code);
export const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Live cluster status, fed by script.js (`helixis:data`, `helixis:network`).
 *   rmi-live      → alive = registry reachable (probe)
 *   catalog-only  → alive = declared status != OFFLINE (registry not running)
 *   none          → gateway unreachable, every node assumed alive (MODEL)
 */
export const live = {
  mode: "none",
  rtt: null,
  coordinator: null,
  nodes: NODES.map(() => ({ alive: true, status: "MODEL", degraded: false })),
  prescriptions: [],
  inventory: [],
  fault: null,
  faultFollow: false,
  listeners: new Set(),
};

export function ingestNetwork(network, rtt) {
  if (!network?.nodes) return;
  live.mode = network.mode;
  if (Number.isFinite(rtt)) live.rtt = rtt;
  live.coordinator = network.coordinator;
  for (const n of network.nodes) {
    const i = NODES.findIndex((d) => d.id === n.nodeId);
    if (i < 0) continue;
    const declared = String(n.declaredStatus || "").toUpperCase();
    const alive = network.mode === "rmi-live" ? Boolean(n.reachable) : declared !== "OFFLINE";
    live.nodes[i] = {
      alive,
      status: network.mode === "rmi-live" ? (n.reachable ? "REACHABLE" : "NO RESPONSE") : declared,
      degraded: declared === "DEGRADED",
    };
  }
  emit();
}

export function ingestData(data) {
  if (data.prescriptions?.items) live.prescriptions = data.prescriptions.items;
  if (data.inventory?.items) live.inventory = data.inventory.items;
  if (data.faultTolerance) live.fault = data.faultTolerance;
  emit();
}

function emit() { for (const fn of live.listeners) fn(live); }
export const onLive = (fn) => { live.listeners.add(fn); return () => live.listeners.delete(fn); };
export const aliveSet = () => NODES.map((_, i) => live.nodes[i].alive);

/* ── Bully election — a port of BullyElection.java's message trace ─────────
 * startElection(initiator): send ELECTION to every higher alive node, each
 * replies OK, then each higher node takes over (depth-first, once per election);
 * a node with no higher alive node broadcasts COORDINATOR.
 * Returns rounds: [{from, kind:"ELECTION", to:[…]}, …, {from, kind:"COORDINATOR", to:[…]}]. */
export function bullyTrace(alive, initiator) {
  const rounds = [];
  const started = new Set();
  let winner = -1;
  const higherAlive = (i) => NODES.map((_, j) => j).filter((j) => j > i && alive[j]);
  const run = (i) => {
    if (started.has(i) || winner >= 0) return;
    started.add(i);
    const higher = higherAlive(i);
    if (!higher.length) {
      winner = i;
      rounds.push({ from: i, kind: "COORDINATOR", to: NODES.map((_, j) => j).filter((j) => j !== i && alive[j]) });
      return;
    }
    rounds.push({ from: i, kind: "ELECTION", to: higher });
    for (const h of higher) run(h);
  };
  if (initiator >= 0) run(initiator);
  return { rounds, winner };
}

/* ── Vector clocks (MODEL) ────────────────────────────────────────────────── */
export const vcZero = () => [0, 0, 0, 0, 0, 0];
export const vcMerge = (a, b) => a.map((v, i) => Math.max(v, b[i]));
export const vcLeq = (a, b) => a.every((v, i) => v <= b[i]);
export function vcCompare(a, b) {
  const ab = vcLeq(a, b), ba = vcLeq(b, a);
  if (ab && ba) return "EQUAL";
  if (ab) return "BEFORE";
  if (ba) return "AFTER";
  return "CONCURRENT";
}
export const vcText = (v) => `[${v.join(",")}]`;

/* ── Hash chain (computed in the browser with SubtleCrypto) ────────────────
 * block_i = SHA-256( canonical(rx_i) || block_{i-1} ), block_0 prev = 64×"0".
 * Sealed once from the records exactly as the gateway served them. The demo
 * tamper then changes prescription 017's quantity AFTER sealing, so the
 * recomputed digest no longer matches its seal and every later link loses its
 * proof. Nothing is written back to the backend. */
export const TAMPER = { index: 16, field: "quantity", to: 90 };
const GENESIS = "0".repeat(64);
const canonical = (rx) => JSON.stringify([rx.id, rx.hash, rx.patientId, rx.doctorLicense, rx.branchCode,
  rx.medicineCode, rx.quantity, rx.dosage, rx.issueDate, rx.expiryDate]);

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const chain = { blocks: [], tampered: true, ready: false, verifyMs: 0, supported: Boolean(globalThis.crypto?.subtle), listeners: new Set() };

export async function sealChain(prescriptions) {
  if (!chain.supported || !prescriptions.length) return;
  const blocks = [];
  let prev = GENESIS;
  for (const rx of prescriptions) {
    const sealed = await sha256(canonical(rx) + prev);
    blocks.push({ rx, prev, sealed, now: sealed, valid: true, linkValid: true, node: byBranch(rx.branchCode) });
    prev = sealed;
  }
  chain.blocks = blocks;
  chain.ready = true;
  await verifyChain();
}

/** Recompute every digest from the CURRENT record contents and compare to the seals. */
export async function verifyChain() {
  if (!chain.ready) return;
  const t0 = performance.now();
  let chainNow = GENESIS;
  for (let i = 0; i < chain.blocks.length; i++) {
    const b = chain.blocks[i];
    const rx = chain.tampered && i === TAMPER.index ? { ...b.rx, [TAMPER.field]: TAMPER.to } : b.rx;
    // content check: this record against its own seal (sealed prev pointer)
    b.now = await sha256(canonical(rx) + b.prev);
    b.valid = b.now === b.sealed;
    // link check: does the stored prev pointer equal the RECOMPUTED previous block?
    b.linkValid = chainNow === b.prev;
    chainNow = await sha256(canonical(rx) + chainNow);
  }
  chain.verifyMs = performance.now() - t0;
  for (const fn of chain.listeners) fn(chain);
}

export function setTamper(on) { chain.tampered = on; return verifyChain(); }
