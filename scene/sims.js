import * as THREE from "three";
import { NODES, live, aliveSet, bullyTrace, vcZero, vcMerge, vcCompare, vcText, chain, TAMPER, pad2 } from "./model.js";
import { nodePosition, chainSlot, PAIRS, pairIndex, isRing } from "./world.js";

/**
 * Chapter simulations. Each one owns its own state so two chapters can be on
 * screen at once, and splits its inputs the way the scroll-engine requires:
 *
 *   scrub(p)       scroll → which protocol phase is shown (deterministic, reversible)
 *   update(t, dt)  time   → messages in flight, pulses, clocks ticking, glitch
 *
 * When scrolling stops, scrub freezes on a phase and update keeps that phase
 * running on a loop — the cluster never becomes a still frame.
 */

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeMove = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // ≈ --e-move
const POS = NODES.map((_, i) => nodePosition(i));

class Wire {
  packets = [];
  send(from, to, { tone = "fg", dur = 0.7, size = 1, onArrive, fizzle = false } = {}) {
    this.packets.push({ a: typeof from === "number" ? POS[from] : from, b: typeof to === "number" ? POS[to] : to,
      to, t: 0, dur, tone, size, onArrive, fizzle });
  }
  tick(dt) {
    for (const p of this.packets) p.t += dt / p.dur;
    const done = this.packets.filter((p) => p.t >= (p.fizzle ? 0.55 : 1));
    this.packets = this.packets.filter((p) => p.t < (p.fizzle ? 0.55 : 1));
    for (const p of done) p.onArrive?.(p);
  }
  clear() { this.packets = []; }
}

class NodeState {
  constructor() { this.alive = 1; this.target = 1; this.pulse = 0; this.leader = 0; this.warn = 0; this.warnTarget = 0; }
  tick(dt, reduced) {
    const k = reduced ? 1 : Math.min(1, dt * 4);
    this.alive += (this.target - this.alive) * k;
    this.warn += (this.warnTarget - this.warn) * k;
    this.pulse = Math.max(0, this.pulse - dt * 2.2);
  }
}

class BaseSim {
  constructor(theme) {
    this.theme = theme;
    this.wire = new Wire();
    this.nodes = NODES.map(() => new NodeState());
    this.p = 0;
    this.phase = -1;
    this.t = 0;
    this.reduced = false;
  }
  syncAlive(set = aliveSet()) { set.forEach((a, i) => { this.nodes[i].target = a ? 1 : 0; }); }
  baseUpdate(dt) {
    this.t += dt;
    this.wire.tick(dt);
    for (const n of this.nodes) n.tick(dt, this.reduced);
  }
  poseNodes(world, links = true) {
    this.nodes.forEach((n, i) => world.poseNode(i, n));
    if (links) {
      PAIRS.forEach(([a, b], k) => {
        const alive = Math.min(this.nodes[a].alive, this.nodes[b].alive);
        world.poseLink(k, 0.1 + 0.12 * alive);
      });
    }
  }
  poseWire(world) { world.posePackets(this.wire.packets); }
  nodeLabels(extra = () => ({})) {
    return NODES.map((d, i) => ({ key: `n${i}`, pos: POS[i], anchor: "node", title: `N${pad2(d.id)} ${d.name.toUpperCase()}`, ...extra(i) }));
  }
}

/* ── 00 HERO — the Mumbai router fans every query out to the six registries ── */
export class HeroSim extends BaseSim {
  constructor() { super("paper"); this.cursor = 0; this.acc = 0; this.queries = 0; }
  scrub(p) { this.p = p; }
  update(t, dt) {
    this.syncAlive();
    this.acc += dt;
    if (this.acc > 0.42 && this.nodes[0].target) {
      this.acc = 0;
      const targets = NODES.map((_, i) => i).filter((i) => i > 0 && this.nodes[i].target);
      if (targets.length) {
        const j = targets[this.cursor++ % targets.length];
        this.wire.send(0, j, { dur: 0.55, onArrive: () => {
          this.nodes[j].pulse = 1;
          this.wire.send(j, 0, { dur: 0.55, size: 0.75, onArrive: () => { this.nodes[0].pulse = 0.8; this.queries++; } });
        } });
      }
    }
    this.baseUpdate(dt);
  }
  apply(world) {
    world.setTheme(this.theme);
    this.nodes.forEach((n, i) => { n.warnTarget = live.nodes[i].degraded ? 0.6 : 0; });
    this.poseNodes(world);
    this.poseWire(world);
    world.poseCrown(live.coordinator ? NODES.findIndex((n) => n.name === live.coordinator) : -1, 1, (this.t % 1.6) / 1.6);
    world.poseClocks(null); world.poseChain(null);
  }
  labels() {
    return this.nodeLabels((i) => ({
      sub: `:${NODES[i].port} · ${i === 0 ? `ROUTER · GW RTT ${live.rtt == null ? "—" : `${live.rtt.toFixed(1)}ms`} · ` : ""}${live.nodes[i].status}`,
      dim: !live.nodes[i].alive,
    }));
  }
}

/* ── 02 NETWORK — bully election, same trace as BullyElection.java ───────── */
export class ElectionSim extends BaseSim {
  constructor(onLog) { super("ink"); this.onLog = onLog; this.cycle = 0; this.recompute(); }
  recompute() {
    this.alive = aliveSet();
    this.initiator = this.alive.findIndex(Boolean);
    const { rounds, winner } = bullyTrace(this.alive, this.initiator);
    this.rounds = rounds;
    this.winner = winner;
    this.steps = ["DETECT", ...rounds.map((r) => (r.kind === "ELECTION" ? `N${pad2(NODES[r.from].id)} ELECTION` : "COORDINATOR"))];
  }
  scrub(p) {
    this.p = p;
    const electionRounds = this.rounds.length - 1;
    let step;
    if (p < 0.12) step = 0;
    else if (p < 0.84) step = 1 + Math.min(electionRounds - 1, Math.floor(((p - 0.12) / 0.72) * electionRounds));
    else step = this.rounds.length;          // COORDINATOR broadcast
    if (step !== this.phase) { this.phase = step; this.cycle = 99; this.wire.clear(); }
  }
  update(t, dt) {
    const set = aliveSet();
    if (set.some((a, i) => a !== this.alive[i])) this.recompute();
    this.syncAlive(set);
    this.cycle += dt;
    const round = this.rounds[this.phase - 1];
    if (this.cycle > 2.6) {
      this.cycle = 0;
      if (this.phase === 0) {
        // the initiator's heartbeat to the (missing) coordinator goes unanswered
        if (this.initiator >= 0) {
          this.wire.send(this.initiator, this.winner >= 0 ? this.winner : 5, { tone: "warn", dur: 0.9, fizzle: true });
          this.log(`N${pad2(NODES[this.initiator].id)} → ?  HEARTBEAT · no coordinator known`);
        }
      } else if (round?.kind === "ELECTION") {
        this.nodes[round.from].pulse = 1;
        for (const to of round.to) {
          this.wire.send(round.from, to, { dur: 0.75, onArrive: () => {
            this.nodes[to].pulse = 1;
            this.wire.send(to, round.from, { tone: "good", dur: 0.6, size: 0.8 });
          } });
        }
        this.log(`N${pad2(NODES[round.from].id)} → ${round.to.map((j) => `N${pad2(NODES[j].id)}`).join(" ")}  ELECTION · OK ×${round.to.length}`);
      } else if (round?.kind === "COORDINATOR") {
        this.nodes[round.from].pulse = 1;
        for (const to of round.to) this.wire.send(round.from, to, { dur: 0.8, size: 1.25, onArrive: () => { this.nodes[to].pulse = 0.7; } });
        this.log(`N${pad2(NODES[round.from].id)} → ALL  COORDINATOR · highest alive ID wins`);
      }
    }
    this.baseUpdate(dt);
  }
  log(line) { this.onLog?.(line); }
  apply(world) {
    world.setTheme(this.theme);
    const crowned = this.phase >= this.rounds.length;
    this.nodes.forEach((n, i) => { n.leader = crowned && i === this.winner ? 1 : 0; n.warnTarget = 0; });
    this.poseNodes(world, false);
    const round = this.rounds[this.phase - 1];
    PAIRS.forEach(([a, b], k) => {
      const alive = Math.min(this.nodes[a].alive, this.nodes[b].alive);
      let v = 0.08 + 0.08 * alive;
      if (round?.kind === "ELECTION" && (a === round.from || b === round.from) && (round.to.includes(a) || round.to.includes(b))) v = 0.55;
      if (crowned && isRing(k)) v = 0.2 + 0.35 * alive;               // the ring lights once a leader exists
      if (crowned && (a === this.winner || b === this.winner)) v = Math.max(v, 0.42 * alive);
      world.poseLink(k, v);
    });
    world.commitLinks();
    this.poseWire(world);
    const grow = this.reduced ? 1 : smooth(0.84, 0.94, this.p);
    world.poseCrown(crowned ? this.winner : -1, grow, (this.t % 1.4) / 1.4);
    world.poseClocks(null); world.poseChain(null);
  }
  labels() {
    const round = this.rounds[this.phase - 1];
    const crowned = this.phase >= this.rounds.length;
    return this.nodeLabels((i) => {
      let sub = `ID ${NODES[i].id} · ${this.alive[i] ? "ALIVE" : "DOWN"}`;
      if (round?.kind === "ELECTION" && round.from === i) sub = `ID ${NODES[i].id} · ELECTION → ${round.to.map((j) => NODES[j].id).join(",")}`;
      if (round?.kind === "ELECTION" && round.to.includes(i)) sub = `ID ${NODES[i].id} > ${NODES[round.from].id} · OK`;
      if (crowned && i === this.winner) sub = `ID ${NODES[i].id} · COORDINATOR`;
      return { sub, dim: !this.alive[i], strong: crowned && i === this.winner };
    });
  }
  rail() {
    const winner = this.winner >= 0 ? NODES[this.winner].name : "none";
    let source = "MODEL";
    if (live.mode === "rmi-live") source = `LIVE COORDINATOR ${String(live.coordinator ?? "none").toUpperCase()} ${live.coordinator === winner ? "= BULLY WINNER" : "≠ MODEL"}`;
    return { steps: this.steps, active: Math.min(this.phase, this.steps.length - 1), source };
  }
}

/* ── 02A FAULT — primary/backup failover, same phases as PrimaryBackupSimulation ── */
const FAULT_PHASES = ["SYNCED · TERM 1", "MUMBAI CRASHES", "PUNE PROMOTED · DEGRADED", "MUMBAI REJOINS · REPLAY", "SYNCED · TERM 2"];
export class FaultSim extends BaseSim {
  constructor() { super("paper"); this.acc = 0; this.cursor = 0; }
  scrub(p) {
    this.p = p;
    this.phase = p < 0.2 ? 0 : p < 0.3 ? 1 : p < 0.55 ? 2 : p < 0.8 ? 3 : 4;
    this.lagModel = this.phase === 2 ? 1 + Math.floor(((p - 0.3) / 0.25) * 3) : this.phase === 3 ? Math.ceil(3 * (1 - (p - 0.55) / 0.25)) : this.phase === 1 ? 0 : 0;
  }
  /** LIVE override: once the operator drives the lab, the scene mirrors the gateway's state machine */
  state() {
    const f = live.fault;
    if (live.faultFollow && f) {
      const mum = f.nodes?.find((n) => n.name === "Mumbai");
      const primary = f.activeNode === "Pune" ? 1 : 0;
      return { source: "LIVE", primary, backup: 1 - primary, down: mum && !mum.available ? 0 : -1,
        catching: f.phase === "CATCHING_UP", term: f.term, lag: f.replicationLag, phase: f.phase };
    }
    const ph = this.phase;
    return { source: "MODEL", primary: ph >= 2 ? 1 : 0, backup: ph >= 2 ? 0 : 1, down: ph === 1 || ph === 2 ? 0 : -1,
      catching: ph === 3, term: ph >= 2 ? 2 : 1, lag: this.lagModel ?? 0, phase: ["SYNCED", "FAILURE", "DEGRADED", "CATCHING_UP", "SYNCED"][ph] };
  }
  update(t, dt) {
    const s = this.state();
    this.nodes.forEach((n, i) => { n.target = i === s.down ? 0 : 1; n.warnTarget = s.catching && i === s.backup ? 0.7 : 0; });
    this.acc += dt;
    if (this.acc > 0.5) {
      this.acc = 0;
      const writers = [2, 3, 4, 5];
      const w = writers[this.cursor++ % writers.length];
      if (s.phase === "FAILURE") {
        // writers still aim at the crashed primary: requests time out mid-wire
        this.wire.send(w, 0, { tone: "warn", dur: 0.8, fizzle: true });
        if (this.cursor % 2) this.wire.send(1, 0, { tone: "warn", dur: 0.7, fizzle: true, size: 0.7 });
      } else {
        const primary = s.primary;
        this.wire.send(w, primary, { dur: 0.6, onArrive: () => {
          this.nodes[primary].pulse = 1;
          if (s.down !== s.backup) {
            this.wire.send(primary, s.backup, { dur: 0.5, size: 0.85, onArrive: () => {
              this.nodes[s.backup].pulse = 0.8;
              this.wire.send(s.backup, primary, { tone: "good", dur: 0.45, size: 0.7 });
            } });
          }
        } });
      }
      if (s.catching && this.cursor % 2 === 0) {
        // catch-up replication: the new primary replays the events the rejoined node missed
        this.wire.send(s.primary, s.backup, { tone: "warn", dur: 0.55, size: 1.2, onArrive: () => { this.nodes[s.backup].pulse = 1; } });
      }
    }
    this.baseUpdate(dt);
  }
  apply(world) {
    world.setTheme(this.theme);
    const s = this.state();
    this.nodes.forEach((n, i) => { n.leader = i === s.primary && i !== s.down ? 0.6 : 0; });
    this.poseNodes(world, false);
    PAIRS.forEach(([a, b], k) => {
      const alive = Math.min(this.nodes[a].alive, this.nodes[b].alive);
      let v = 0.07 + 0.08 * alive;
      if ((a === s.primary || b === s.primary) && alive > 0.5) v = 0.3;
      if (k === pairIndex(0, 1)) v = s.down >= 0 ? 0.06 : 0.6;        // the replication link
      world.poseLink(k, v, k === pairIndex(0, 1) && s.catching ? "warn" : "fg");
    });
    world.commitLinks();
    this.poseWire(world);
    world.poseCrown(-1, 0, 0);
    world.poseClocks(null); world.poseChain(null);
  }
  labels() {
    const s = this.state();
    return this.nodeLabels((i) => {
      let sub = i > 1 ? "WRITER" : "";
      if (i === s.primary) sub = `${i === 1 ? "PROMOTED " : ""}PRIMARY · TERM ${s.term}`;
      if (i === s.backup) sub = s.catching ? `BACKUP · REPLAY LAG ${s.lag}` : "BACKUP · IN SYNC";
      if (i === s.down) sub = "DOWN · NO HEARTBEAT";
      return { sub, dim: i > 1, strong: i === s.primary, tone: i === s.down ? "dead" : s.catching && i === s.backup ? "warn" : "" };
    });
  }
  rail() {
    const s = this.state();
    const active = s.source === "LIVE" ? ({ SYNCED: s.term > 1 ? 4 : 0, DEGRADED: 2, CATCHING_UP: 3 })[s.phase] ?? 0 : this.phase;
    return { steps: FAULT_PHASES, active, source: s.source };
  }
}

/* ── 02B CONSISTENCY — vector clocks + optimistic concurrency on a real CONFLICT row ── */
const DEL = 3, BLR = 2;
const CONS_PHASES = ["CAUSAL TRAFFIC", "CONCURRENT WRITES", "CONFLICT DETECTED", "OCC RESOLVES"];
export class ClockSim extends BaseSim {
  constructor(onReadout) { super("paper"); this.onReadout = onReadout; this.reset(); this.acc = 0; this.run = 1; }
  reset() { this.vc = NODES.map(() => vcZero()); this.snap = null; this.version = 7; }
  scrub(p) {
    this.p = p;
    const ph = p < 0.3 ? 0 : p < 0.52 ? 1 : p < 0.76 ? 2 : 3;
    if (ph !== this.phase) this.enterPhase(ph);
  }
  enterPhase(ph) {
    this.phase = ph;
    this.wire.clear();
    if (ph === 0) { this.snap = null; this.version = 7; }
    if (ph >= 1 && !this.snap) {
      // both replicas of MED-0009 write without having seen each other's write
      this.vc[DEL][DEL]++; this.vc[BLR][BLR]++;
      this.snap = { del: [...this.vc[DEL]], blr: [...this.vc[BLR]] };
      this.nodes[DEL].pulse = 1; this.nodes[BLR].pulse = 1;
    }
    if (ph < 3) this.version = 7;
    if (ph === 3 && this.snap) {
      this.version = 8;
      const merged = vcMerge(this.vc[DEL], this.vc[BLR]);
      this.vc[DEL] = [...merged]; this.vc[BLR] = [...merged];
      this.vc[DEL][DEL]++;
      this.vc[BLR] = [...this.vc[DEL]];
    }
    this.emitReadout();
  }
  emitReadout() {
    this.onReadout?.({
      phase: this.phase, snap: this.snap, relation: this.snap ? vcCompare(this.snap.del, this.snap.blr) : null,
      version: this.version, text: this.snap ? { del: vcText(this.snap.del), blr: vcText(this.snap.blr) } : null,
    });
  }
  update(t, dt) {
    this.acc += dt;
    const every = 0.45;
    if (this.acc > every) {
      this.acc = 0;
      let i = Math.floor(Math.random() * 6);
      const lock = this.phase === 1 || this.phase === 2;           // keep the two writers concurrent
      if (Math.random() < 0.6) {
        let j = Math.floor(Math.random() * 5); if (j >= i) j++;
        if (lock && ((i === DEL && j === BLR) || (i === BLR && j === DEL))) j = 0;
        this.vc[i][i]++;
        const msg = [...this.vc[i]];
        this.wire.send(i, j, { dur: 0.65, size: 0.8, onArrive: () => {
          this.vc[j] = vcMerge(this.vc[j], msg); this.vc[j][j]++; this.nodes[j].pulse = 0.8;
        } });
      } else {
        this.vc[i][i]++; this.nodes[i].pulse = 0.4;
      }
      if (this.phase === 2 && Math.random() < 0.5) {
        // anti-entropy between the two replicas: each sees an incomparable clock
        this.wire.send(DEL, BLR, { tone: "warn", dur: 0.7, fizzle: false });
        this.wire.send(BLR, DEL, { tone: "warn", dur: 0.7 });
      }
      if (this.phase === 3 && Math.random() < 0.5) {
        // OCC: DEL's write carried expected v7 → commits v8; BLR's stale v7 write is rejected, re-read, merged
        this.wire.send(BLR, DEL, { tone: "warn", dur: 0.6, fizzle: true });
        this.wire.send(DEL, BLR, { tone: "good", dur: 0.6, size: 1.1 });
      }
      if (Math.max(...this.vc.flat()) > 24) { this.reset(); this.run++; this.snap = null; if (this.phase >= 1) this.enterPhase(this.phase); }
    }
    this.nodes.forEach((n, i) => {
      n.target = 1;
      n.warnTarget = (i === DEL || i === BLR) && (this.phase === 1 || this.phase === 2) ? 0.9 : 0;
    });
    this.baseUpdate(dt);
  }
  apply(world) {
    world.setTheme(this.theme);
    this.poseNodes(world, false);
    PAIRS.forEach((_, k) => world.poseLink(k, k === pairIndex(DEL, BLR) && this.phase >= 1 ? 0.55 : 0.12, k === pairIndex(DEL, BLR) && (this.phase === 1 || this.phase === 2) ? "warn" : "fg"));
    world.commitLinks();
    this.poseWire(world);
    world.poseCrown(-1, 0, 0);
    const tones = NODES.map((_, i) => ((i === DEL || i === BLR) ? (this.phase === 3 ? "good" : this.phase >= 1 ? "warn" : "") : ""));
    world.poseClocks(this.vc, tones);
    world.poseChain(null);
  }
  labels() {
    return this.nodeLabels((i) => ({
      sub: vcText(this.vc[i]),
      tone: (i === DEL || i === BLR) && this.phase >= 1 ? (this.phase === 3 ? "good" : "warn") : "",
      strong: (i === DEL || i === BLR) && this.phase >= 1,
    }));
  }
  rail() { return { steps: CONS_PHASES, active: Math.max(0, this.phase), note: `MODEL RUN ${this.run}` }; }
}

/* ── 02C INTEGRITY — SHA-256 chain over the 20 prescriptions; 017 breaks ─── */
const CHAIN_PHASES = ["APPEND 001–010", "APPEND 011–020", "RECOMPUTE", "017 FAILS"];
export class ChainSim extends BaseSim {
  constructor() { super("ink"); this.cols = 10; this.sweep = 0; this.v = new THREE.Vector3(); this.blockPos = Array.from({ length: 20 }, () => new THREE.Vector3()); }
  scrub(p) {
    this.p = p;
    this.phase = p < 0.34 ? 0 : p < 0.66 ? 1 : p < 0.8 ? 2 : 3;
  }
  update(t, dt) {
    this.syncAlive();
    this.sweep = (this.sweep + dt * 5) % 26;
    this.baseUpdate(dt);
  }
  blocks() {
    const n = 20;
    const assembled = this.reduced ? n : (Math.min(this.p, 0.66) / 0.66) * n;
    const checking = this.p >= 0.66 ? Math.floor(this.sweep) : -1;
    const judged = this.reduced || this.p >= 0.8;
    return Array.from({ length: n }, (_, k) => {
      const b = chain.blocks[k];
      const f = Math.min(1, Math.max(0, assembled - k));
      const from = b && b.node >= 0 ? POS[b.node] : POS[k % 6];
      const pos = this.blockPos[k].lerpVectors(from, chainSlot(k, this.v, this.cols), easeMove(f));
      let state = "pending";
      if (f >= 1) state = "valid";
      if (judged && b && !b.valid) state = "tampered";
      else if (judged && b && !b.linkValid) state = "link";
      return { visible: f > 0, placed: f >= 1, pos, state, checking: checking === k, k };
    });
  }
  apply(world, quality, aspect = 2) {
    this.cols = aspect < 0.95 ? 5 : 10;          // phone: 4 rows of 5, serpentine
    world.setTheme(this.theme);
    // the cluster stays visible as the blocks' origin, but its mesh recedes behind the chain
    this.poseNodes(world, false);
    PAIRS.forEach((_, k) => world.poseLink(k, 0.05));
    world.commitLinks();
    // once the camera settles on the chain, the cluster fades to a faint origin mark
    const fade = this.reduced ? 0.12 : Math.max(0.12, 1 - smooth(0.3, 0.45, this.p));
    const t = world.palette[this.theme];
    world.nodes.forEach((n) => { n.outline.material.color.copy(t.bg).lerp(t.mid, fade); n.mat.uniforms.uAlive.value *= fade; n.mat.uniforms.uDead.value.copy(t.bg); });
    this.poseWire(world);
    world.poseCrown(-1, 0, 0);
    world.poseClocks(null);
    const blocks = this.blocks();
    this.last = blocks;
    const tampered = blocks[TAMPER.index]?.state === "tampered";
    // glitch envelope: short tears every ~1.7s, frozen to a legible still under reduced motion
    const env = this.reduced ? 0 : Math.pow(Math.max(0, Math.sin(this.t * 3.7)), 18) * 2.2 + Math.max(0, Math.sin(this.t * 23.0)) * 0.08;
    world.poseChain(blocks, { visible: tampered, amount: env, quality: quality === "low" ? 0 : 1 });
  }
  labels(narrow) {
    const blocks = this.last ?? [];
    const out = [];
    blocks.forEach((b, k) => {
      if (!b.visible) return;
      const data = chain.blocks[k];
      const id = String(k + 1).padStart(3, "0");
      const hash = data ? data.sealed.slice(0, 6) : "······";
      if (b.state === "tampered" && data) {
        out.push({ key: `b${k}`, pos: b.pos, anchor: "block", title: narrow ? `${id} ✕` : `RX ${id} ✕`, sub: narrow ? "" : "TAMPERED", tone: "danger", strong: true });
      } else {
        if (narrow && ![0, 4, 5, 9, 10, 14, 15, 19].includes(k)) return;   // phone: row ends only
        out.push({ key: `b${k}`, pos: b.pos, anchor: "block", title: narrow ? id : `RX ${id}`, sub: narrow ? "" : (b.state === "link" ? "prev ≠ now" : hash), tone: b.state === "link" ? "warn" : "", dim: b.state === "pending" });
      }
    });
    return out;
  }
  rail() { return { steps: CHAIN_PHASES, active: Math.max(0, this.phase) }; }
}
