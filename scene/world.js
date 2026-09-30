import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { nodeVert, nodeFieldFrag, glitchFrag } from "./shaders.js";
import { NODES } from "./model.js";

/**
 * The one world every view renders. Procedural geometry only (no textures,
 * no models): scene assets weigh 0 bytes beyond the code.
 *
 * Objects are shared; each chapter simulation POSES them immediately before
 * its view is drawn, so two windows on screen can show two chapters of the
 * same cluster in the same frame.
 */
export const RADIUS = 4;
export const nodePosition = (i, out = new THREE.Vector3()) => {
  const a = Math.PI / 2 + i * (Math.PI * 2 / 6);
  return out.set(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS);
};
export const PAIRS = [];
for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) PAIRS.push([a, b]);
export const pairIndex = (a, b) => PAIRS.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
const RING = new Set([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]].map(([a, b]) => pairIndex(a, b)));
export const isRing = (k) => RING.has(k);

/* chain slots: two rows of ten, serpentine so the 10 → 11 link is short */
export const chainSlot = (k, out = new THREE.Vector3(), cols = 10) => {
  const row = Math.floor(k / cols);
  const rows = Math.ceil(20 / cols);
  const i = k % cols;
  const col = row % 2 === 0 ? i : cols - 1 - i;
  return out.set((col - (cols - 1) / 2) * 1.18, ((rows - 1) / 2 - row) * 1.5 + 0.3, 6.4);
};

const PRISM_H = 1.0;
const MAX_PACKETS = 96;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class World {
  constructor(palette) {
    this.palette = palette;
    this.scene = new THREE.Scene();
    this.lineMaterials = [];
    this.theme = null;

    this.#buildNodes();
    this.#buildLinks();
    this.#buildCrown();
    this.#buildPackets();
    this.#buildClocks();
    this.#buildChain();
  }

  /* ── construction ─────────────────────────────────────────────────────── */
  #line(width) {
    const m = new LineMaterial({ linewidth: width, vertexColors: false, worldUnits: false });
    this.lineMaterials.push(m);
    return m;
  }

  #buildNodes() {
    const geo = new THREE.CylinderGeometry(0.62, 0.62, PRISM_H, 6, 1);
    const edges = new THREE.EdgesGeometry(geo);
    const edgePositions = edges.attributes.position.array;
    this.nodes = NODES.map((d, i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: nodeVert,
        fragmentShader: nodeFieldFrag,
        uniforms: {
          uTime: { value: 0 }, uBg: { value: new THREE.Color() }, uFg: { value: new THREE.Color() },
          uDead: { value: new THREE.Color() }, uWarnCol: { value: new THREE.Color() },
          uAlive: { value: 1 }, uPulse: { value: 0 }, uLeader: { value: 0 }, uSeed: { value: i * 1.7 },
          uWarn: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) },
        },
      });
      const mesh = new THREE.Mesh(geo, mat);
      const pos = nodePosition(i);
      mesh.position.copy(pos);
      const g = new LineSegmentsGeometry().setPositions(edgePositions);
      const outline = new LineSegments2(g, this.#line(1.4));
      outline.position.copy(pos);
      this.scene.add(mesh, outline);
      return { id: d.id, mesh, mat, outline, pos };
    });
  }

  #buildLinks() {
    const pos = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const [i, j] of PAIRS) {
      nodePosition(i, a); nodePosition(j, b);
      pos.push(a.x, -0.35, a.z, b.x, -0.35, b.z);
    }
    const g = new LineSegmentsGeometry().setPositions(pos);
    g.setColors(new Array(PAIRS.length * 6).fill(0));
    const m = this.#line(1.1);
    m.vertexColors = true;
    this.links = new LineSegments2(g, m);
    this.linkColors = g.attributes.instanceColorStart.data;
    this.scene.add(this.links);
  }

  #buildCrown() {
    this.crown = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.022, 6, 72), mat);
    ring.rotation.x = Math.PI / 2;
    const beat = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.012, 6, 72), mat.clone());
    beat.rotation.x = Math.PI / 2;
    beat.material.transparent = true;
    this.crownMat = mat;
    this.crownBeat = beat;
    this.crown.add(ring, beat);
    this.crown.visible = false;
    this.scene.add(this.crown);
  }

  #buildPackets() {
    this.packetMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial(), MAX_PACKETS);
    this.packetMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PACKETS * 3), 3);
    this.packetMesh.count = 0;
    this.packetMesh.frustumCulled = false;
    this.scene.add(this.packetMesh);
  }

  /* vector clocks: 6 columns above each node; column k = that node's entry for node k */
  #buildClocks() {
    this.clockMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 36);
    this.clockMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(36 * 3), 3);
    this.clockMesh.frustumCulled = false;
    this.clockMesh.visible = false;
    this.scene.add(this.clockMesh);
  }

  #buildChain() {
    this.chainGroup = new THREE.Group();
    const box = new THREE.BoxGeometry(0.8, 0.5, 0.34);
    const edges = new THREE.EdgesGeometry(box).attributes.position.array;
    this.blocks = [];
    for (let k = 0; k < 20; k++) {
      const mat = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(box, mat);
      const outline = new LineSegments2(new LineSegmentsGeometry().setPositions(edges), this.#line(1.3));
      const g = new THREE.Group();
      g.add(mesh, outline);
      g.visible = false;
      this.chainGroup.add(g);
      this.blocks.push({ group: g, mat, outline });
    }
    // links between consecutive blocks (prev-hash pointers)
    const lp = new Array(19 * 6).fill(0);
    const lg = new LineSegmentsGeometry().setPositions(lp);
    lg.setColors(new Array(19 * 6).fill(0));
    const lm = this.#line(1.6);
    lm.vertexColors = true;
    this.chainLinks = new LineSegments2(lg, lm);
    this.chainLinkPos = lg.attributes.instanceStart.data;
    this.chainLinkCol = lg.attributes.instanceColorStart.data;
    this.chainGroup.add(this.chainLinks);

    // 017 tamper plate — library distortion shader over a hash texture drawn at runtime
    this.glitchCanvas = document.createElement("canvas");
    this.glitchCanvas.width = 512; this.glitchCanvas.height = 320;
    this.glitchTex = new THREE.CanvasTexture(this.glitchCanvas);
    this.glitchTex.colorSpace = THREE.SRGBColorSpace;
    this.glitchMat = new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: glitchFrag,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: this.glitchTex }, uPlaneSize: { value: new THREE.Vector2(512, 320) },
        uImageSize: { value: new THREE.Vector2(512, 320) }, uHover: { value: 0 }, uReveal: { value: 1 },
        uQuality: { value: 1 }, uVelocity: { value: 0 }, uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2() }, uResolution: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.glitchPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), this.glitchMat);
    this.glitchPlate.position.z = 0.172;
    this.glitchPlate.visible = false;
    this.blocks[16].group.add(this.glitchPlate);
    this.chainGroup.visible = false;
    this.scene.add(this.chainGroup);
  }

  /* ── per-view posing API used by the simulations ──────────────────────── */
  setTheme(theme) {
    if (this.theme === theme) return;
    this.theme = theme;
    const t = this.palette[theme];
    for (const n of this.nodes) {
      n.mat.uniforms.uBg.value.copy(t.bg);
      n.mat.uniforms.uFg.value.copy(t.fg);
      n.mat.uniforms.uDead.value.copy(t.dead);
      n.mat.uniforms.uWarnCol.value.copy(t.warn);
    }
    this.crownMat.color.copy(t.fg);
    this.crownBeat.material.color.copy(t.fg);
  }

  setResolution(w, h) { for (const m of this.lineMaterials) m.resolution.set(w, h); }

  setTime(t) {
    for (const n of this.nodes) n.mat.uniforms.uTime.value = t;
    this.glitchMat.uniforms.uTime.value = t;
  }

  /** alive 0..1 (animated), pulse 0..1, leader 0..1, warn 0..1 */
  poseNode(i, { alive = 1, pulse = 0, leader = 0, warn = 0, lift = 0 }) {
    const n = this.nodes[i], u = n.mat.uniforms, t = this.palette[this.theme];
    u.uAlive.value = alive; u.uPulse.value = pulse; u.uLeader.value = leader; u.uWarn.value = warn;
    n.mesh.position.y = lift;
    n.outline.position.y = lift;
    _c.copy(t.mid).lerp(t.fg, alive);
    if (warn > 0.01) _c.lerp(t.warn, warn);
    n.outline.material.color.copy(_c);
  }

  /** intensity 0 (hidden) .. 1 (bright); tone: "fg" | "good" | "warn" */
  poseLink(k, intensity, tone = "fg") {
    const t = this.palette[this.theme];
    _c.copy(t.bg).lerp(t[tone] ?? t.fg, intensity);
    const a = this.linkColors.array;
    a.set([_c.r, _c.g, _c.b, _c.r, _c.g, _c.b], k * 6);
  }
  commitLinks() { this.linkColors.needsUpdate = true; }

  poseCrown(i, scale, beat) {
    this.crown.visible = i >= 0 && scale > 0.001;
    if (!this.crown.visible) return;
    this.crown.position.copy(this.nodes[i].pos).setY(-PRISM_H / 2 + 0.03);   // hugs the winner's base, beside its own label
    this.crown.scale.setScalar(scale);
    this.crownBeat.scale.setScalar(1 + beat * 0.5);
    this.crownBeat.material.opacity = 1 - beat;
  }

  /** packets: [{a: Vector3, b: Vector3, t, tone, size}] */
  posePackets(list) {
    const t = this.palette[this.theme];
    const n = Math.min(list.length, MAX_PACKETS);
    for (let k = 0; k < n; k++) {
      const p = list[k];
      _v.lerpVectors(p.a, p.b, p.t);
      _v.y += Math.sin(p.t * Math.PI) * (p.arc ?? 0.55);
      _q.setFromAxisAngle(_s.set(0, 1, 0), p.t * 3.0);
      _m.compose(_v, _q, _s.setScalar(p.size ?? 1));
      this.packetMesh.setMatrixAt(k, _m);
      this.packetMesh.setColorAt(k, t[p.tone] ?? t.fg);
    }
    this.packetMesh.count = n;
    this.packetMesh.instanceMatrix.needsUpdate = true;
    this.packetMesh.instanceColor.needsUpdate = true;
  }

  /** clocks: 6×6 matrix or null; highlight: node index whose own entry is emphasised */
  poseClocks(clocks, tones) {
    this.clockMesh.visible = Boolean(clocks);
    if (!clocks) return;
    const t = this.palette[this.theme];
    let k = 0;
    for (let i = 0; i < 6; i++) {
      const base = this.nodes[i].pos;
      for (let j = 0; j < 6; j++) {
        const h = Math.max(0.02, clocks[i][j] * 0.07);
        _v.set(base.x + (j - 2.5) * 0.15, PRISM_H / 2 + 0.12 + h / 2, base.z);
        _m.compose(_v, _q.identity(), _s.set(0.11, h, 0.11));
        this.clockMesh.setMatrixAt(k, _m);
        _c.copy(j === i ? t.fg : t.mid);
        if (tones?.[i]) _c.lerp(t[tones[i]], j === i ? 1 : 0.6);
        this.clockMesh.setColorAt(k, _c);
        k++;
      }
    }
    this.clockMesh.instanceMatrix.needsUpdate = true;
    this.clockMesh.instanceColor.needsUpdate = true;
  }

  /**
   * blocks: [{visible, pos: Vector3, state: "pending"|"valid"|"link"|"tampered", checking}]
   * links:  [{visible, tone}] for k→k+1
   */
  poseChain(blocks, glitch) {
    this.chainGroup.visible = Boolean(blocks);
    if (!blocks) return;
    const t = this.palette[this.theme];
    const lp = this.chainLinkPos.array, lc = this.chainLinkCol.array;
    blocks.forEach((b, k) => {
      const B = this.blocks[k];
      B.group.visible = b.visible;
      if (!b.visible) return;
      B.group.position.copy(b.pos);
      const tone = b.state === "tampered" ? t.danger : b.state === "link" ? t.warn : t.fg;
      B.outline.material.color.copy(tone);
      B.mat.color.copy(t.bg).lerp(b.state === "tampered" ? t.danger : t.fg, b.state === "tampered" ? 0.28 : b.checking ? 0.22 : 0.06);
    });
    for (let k = 0; k < 19; k++) {
      const a = blocks[k], b = blocks[k + 1];
      const show = a.visible && b.visible && a.placed && b.placed;
      const o = k * 6;
      if (show) {
        lp.set([a.pos.x + (a.pos.x < b.pos.x ? 0.4 : a.pos.x > b.pos.x ? -0.4 : 0), a.pos.y + (a.pos.y > b.pos.y ? -0.25 : 0), a.pos.z,
                b.pos.x + (a.pos.x < b.pos.x ? -0.4 : a.pos.x > b.pos.x ? 0.4 : 0), b.pos.y + (a.pos.y > b.pos.y ? 0.25 : 0), b.pos.z], o);
      } else lp.fill(0, o, o + 6);
      _c.copy(b.state === "link" || b.state === "tampered" ? t.warn : t.mid);
      lc.set([_c.r, _c.g, _c.b, _c.r, _c.g, _c.b], o);
    }
    this.chainLinkPos.needsUpdate = true;
    this.chainLinkCol.needsUpdate = true;
    this.chainLinks.geometry.computeBoundingSphere();

    this.glitchPlate.visible = Boolean(glitch?.visible);
    if (glitch?.visible) {
      this.glitchMat.uniforms.uVelocity.value = glitch.amount;
      this.glitchMat.uniforms.uQuality.value = glitch.quality;
    }
  }

  /** draw the 017 hash text into the glitch texture (danger ink on transparent) */
  /** 017 face: no text (the HUD label and readout carry the words) — torn digest bars only */
  paintGlitch(_lines, danger) {
    const c = this.glitchCanvas.getContext("2d");
    c.clearRect(0, 0, 512, 320);
    c.fillStyle = `#${danger.getHexString(THREE.SRGBColorSpace)}`;
    const widths = [0.82, 0.55, 0.7, 0.38, 0.64];
    widths.forEach((w, k) => c.fillRect(40, 44 + k * 52, 432 * w, 18));
    this.glitchTex.needsUpdate = true;
  }

  hideChapterObjects() {
    this.clockMesh.visible = false;
    this.chainGroup.visible = false;
    this.crown.visible = false;
    this.packetMesh.count = 0;
  }
}
