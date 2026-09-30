import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { gsap } from "gsap";
import { Quality } from "../../../engine/Quality.js";

/**
 * The landing stage. One renderer, one scene, one tick (gsap.ticker, shared with
 * ScrollTrigger so the DOM and the GPU read the same scroll frame).
 *
 *   scrub  → `state` (tweened by the scroll timeline): where the capsule is, how
 *            open it is, how far the granules have flown, whether they have
 *            re-formed into the six nodes.
 *   update → time: idle spin, float, orbiting node-capsules, granule drift.
 */
export const NODES = [
  ["N01", "MUMBAI", 1099], ["N02", "PUNE", 1100], ["N03", "BENGALURU", 1101],
  ["N04", "DELHI", 1102], ["N05", "HYDERABAD", 1103], ["N06", "CHENNAI", 1104],
];
const TAU = Math.PI * 2;
const FOV = 30;
const CAM_Z = 12;

/* token → linear THREE.Color, via a 1px 2D canvas so oklch() resolves */
const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
function token(name) {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

export { createState } from './state.js';

export class Stage {
  constructor({ canvas, labels, state, reducedMotion }) {
    this.state = state;
    this.rm = reducedMotion;
    this.labelsEl = labels;
    this.quality = new Quality();
    this.t = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 5, 6);
    this.scene.add(key);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0, CAM_Z);

    this.colors = { ink: token("--ink"), paper: token("--paper"), line: token("--line") };
    this.inkMat = new THREE.MeshPhysicalMaterial({ color: this.colors.ink, roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
    this.paperMat = new THREE.MeshPhysicalMaterial({ color: this.colors.paper, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.2 });

    // rig → tilt → spin → model (model's long axis is Z; rotate it to Y)
    this.rig = new THREE.Group();
    this.tilt = new THREE.Group();
    this.spin = new THREE.Group();
    this.rig.add(this.tilt);
    this.tilt.add(this.spin);
    this.scene.add(this.rig);

    this.#buildShadow();
    this.#buildGranules();
    this.#buildLabels();
    this.ready = this.#load();

    this.onResize = () => this.resize();
    addEventListener("resize", this.onResize);
    this.quality.on("change", () => this.resize());
    this.resize();
    this.tick = this.tick.bind(this);
    gsap.ticker.add(this.tick);
    document.addEventListener("visibilitychange", this.onVis = () => (document.hidden ? gsap.ticker.remove(this.tick) : gsap.ticker.add(this.tick)));
  }

  async #load() {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/capsule.glb`);
    const halves = {};
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      // The optimised GLB is quantized (KHR_mesh_quantization): positions are normalised
      // ints and the real size lives in the node transform. De-quantize to floats and
      // bake that transform in, so each half keeps the model's true 1 × 2.4 proportions.
      const src = o.geometry.attributes.position;
      const pos = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) { pos[i * 3] = src.getX(i); pos[i * 3 + 1] = src.getY(i); pos[i * 3 + 2] = src.getZ(i); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (o.geometry.index) geo.setIndex(o.geometry.index);
      geo.applyMatrix4(o.matrixWorld);
      geo.computeVertexNormals();              // the reconstruction ships positions only
      halves[o.name] = { geometry: geo };
    });
    const build = (scale = 1) => {
      const model = new THREE.Group();
      model.rotation.x = -Math.PI / 2;          // Z (long axis) → Y
      const upper = new THREE.Mesh(halves.Upper_Cap.geometry, this.inkMat);
      const lower = new THREE.Mesh(halves.Lower_Cap.geometry, this.paperMat);
      model.add(upper, lower);
      model.scale.setScalar(scale);
      return { model, upper, lower };
    };
    this.hero = build(1);
    this.spin.add(this.hero.model);
    // the six nodes: small copies of the same capsule orbiting the hero
    this.orbiters = NODES.map(() => {
      const c = build(0.3);
      const g = new THREE.Group();
      g.add(c.model);
      this.scene.add(g);
      return g;
    });
    return true;
  }

  #buildShadow() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, getComputedStyle(document.documentElement).getPropertyValue("--ink").trim());
    grad.addColorStop(1, "transparent");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.16, depthWrite: false }));
    this.scene.add(this.shadow);
  }

  #buildGranules() {
    const n = this.quality.tier === "low" ? 360 : 720;
    this.gCount = n;
    this.granules = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.045, 1), new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.6 }), n);
    this.granules.frustumCulled = false;
    this.gData = Array.from({ length: n }, (_, i) => {
      const dir = new THREE.Vector3().randomDirection();
      // burst away from the copy column: most granules fly right/up/down, few cross left
      if (dir.x < 0 && Math.random() < 0.8) dir.x *= -0.4;
      dir.z *= 0.6;
      return {
        dir, reach: 1.8 + Math.random() * 2.6, seed: Math.random() * TAU,
        node: i % 6, jitter: new THREE.Vector3().randomDirection().multiplyScalar(0.12 + Math.random() * 0.26),
        size: 0.6 + Math.random() * 0.8,
      };
    });
    const c = new THREE.Color();
    this.gData.forEach((d, i) => this.granules.setColorAt(i, c.copy(i % 5 === 0 ? this.colors.ink : this.colors.paper)));
    this.scene.add(this.granules);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
  }

  #buildLabels() {
    this.labelEls = NODES.map(([id, city, port]) => {
      const el = document.createElement("div");
      el.className = "node-label";
      el.innerHTML = `<b>${id} ${city}</b><span>:${port}</span>`;
      this.labelsEl.appendChild(el);
      return el;
    });
    this.anchors = NODES.map(() => new THREE.Vector3());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.quality.settings.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.narrow = this.camera.aspect < 0.8;
  }

  /** where a node sits in the final ring (and where its granule cluster gathers) */
  ringPos(i, centre, out) {
    const r = this.narrow ? 1.1 : 2.35;
    const a = -Math.PI / 2 + i * (TAU / 6);
    // phones: the ring gathers in the top band, clear of the copy stacked below
    const cy = this.narrow ? 0.6 * (this.halfH ?? 3) : centre.y;
    return out.set(centre.x + Math.cos(a) * r, cy + Math.sin(a) * r * 0.62, centre.z + Math.sin(a) * 0.9);
  }

  tick(_time, deltaMs) {
    const dt = this.rm ? 0 : Math.min(deltaMs, 64) / 1000;
    this.t += dt;
    const s = this.state, t = this.t;
    const halfH = Math.tan((FOV * Math.PI) / 360) * CAM_Z, halfW = halfH * this.camera.aspect;

    // layout: desktop puts the capsule in the right 7/12; phones stack it above the copy
    const cx = this.narrow ? s.capX * halfW * 0.15 : s.capX * halfW;
    // phones: copy sits at the bottom, so the capsule (and its orbit) lives in the top band
    const cy = this.narrow ? 0.42 * halfH + s.capY * halfH * 0.2 : s.capY * halfH;
    this.halfH = halfH;
    const scale = s.capScale * (this.narrow ? 0.62 : 1) * (0.6 + 0.4 * s.intro);
    this.rig.position.set(cx, cy + Math.sin(t * 0.9) * 0.08, 0);
    this.rig.scale.setScalar(scale);
    this.tilt.rotation.z = s.tilt;
    this.spin.rotation.y = t * 0.45 + s.turn;                      // idle spin around the long axis
    this.tilt.rotation.x = Math.sin(t * 0.35) * 0.12;             // slow precession

    if (this.hero) {
      const gap = s.split * 1.25;
      this.hero.upper.position.z = gap;                           // separate along the shared axis
      this.hero.lower.position.z = -gap;
      this.hero.upper.rotation.x = s.split * 0.35;
      this.hero.lower.rotation.x = -s.split * 0.28;
      const shrink = 1 - s.ring * 0.45;
      this.hero.model.scale.setScalar(shrink);
    }

    this.shadow.position.set(cx, cy - 1.75 * scale, -0.6);
    this.shadow.scale.setScalar(scale * (1 - s.split * 0.4));
    this.shadow.material.opacity = 0.16 * (1 - s.burst);

    // six node-capsules orbiting the hero on a tilted ring
    const centre = this.rig.position;
    if (this.orbiters) {
      this.orbiters.forEach((g, i) => {
        const a = t * 0.32 + i * (TAU / 6);
        const r = (this.narrow ? 1.6 : 2.7) * s.orbit;
        g.visible = s.orbit > 0.01;
        g.position.set(centre.x + Math.cos(a) * r, centre.y + Math.sin(a) * r * 0.38, Math.sin(a) * r * 0.7);
        g.scale.setScalar(Math.max(0.001, s.orbit) * (this.narrow ? 0.7 : 1));
        g.rotation.set(0.4, t * 0.8 + i, 0.6 + i * 0.3);
        if (s.orbit > 0.01) this.anchors[i].copy(g.position);
      });
    }

    // granules: burst out of the opened capsule, drift, then gather into six clusters
    const g = this.granules, m = this._m, q = this._q, sc = this._s, p = this._p;
    const visible = s.burst > 0.001;
    g.visible = visible;
    if (visible) {
      const target = new THREE.Vector3();
      for (let i = 0; i < this.gCount; i++) {
        const d = this.gData[i];
        const out = s.burst * d.reach * scale;
        p.copy(d.dir).multiplyScalar(out).add(centre);
        p.x += Math.sin(t * 0.6 + d.seed) * 0.12 * s.burst;
        p.y += Math.cos(t * 0.5 + d.seed * 1.3) * 0.12 * s.burst;
        this.ringPos(d.node, centre, target).add(d.jitter);
        target.x += Math.sin(t * 1.1 + d.seed) * 0.05;
        p.lerp(target, s.ring);
        q.setFromAxisAngle(sc.set(0, 1, 0), t + d.seed);
        m.compose(p, q, sc.setScalar(d.size * (0.4 + 0.6 * s.burst) * (this.narrow ? 0.8 : 1)));
        g.setMatrixAt(i, m);
      }
      g.instanceMatrix.needsUpdate = true;
      if (s.ring > 0.01) NODES.forEach((_, i) => this.ringPos(i, centre, this.anchors[i]));
    }

    // node labels: DOM, projected — they follow the orbiters, then the clusters
    const show = Math.max(s.labels * s.orbit, s.labels * s.ring);
    this.labelsEl.style.opacity = show.toFixed(3);
    if (show > 0.01) {
      this.labelEls.forEach((el, i) => {
        p.copy(this.anchors[i]); p.y -= this.narrow ? 0.32 : 0.42;
        p.project(this.camera);
        el.style.transform = `translate3d(${((p.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px, 0) translate(-50%, 0)`;
      });
    }

    this.renderer.render(this.scene, this.camera);
    if (!this.rm) this.quality.sample(deltaMs);
  }

  destroy() {
    gsap.ticker.remove(this.tick);
    removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVis);
    this.renderer.dispose();
    this.labelEls.forEach((el) => el.remove());
  }
}
