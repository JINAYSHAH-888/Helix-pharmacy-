import * as THREE from "three";
import { postFrag, screenVert } from "./shaders.js";

/**
 * Scroll-rig renderer: ONE fixed canvas, ONE scene, N views. Each view is a
 * DOM window ([data-scene]); the renderer scissors the world into that
 * window's live rect, so the browser keeps doing layout and the GPU only
 * paints where a window is. Labels are real DOM, projected per frame into a
 * fixed HUD layer and clipped to the same rect.
 */
const FOV = 32;
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const lerp = (a, b, t) => a + (b - a) * t;
const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // --e-move
const c01 = (x) => Math.min(1, Math.max(0, x));

/* camera per chapter: spherical around a target; chapters meet at their seams so
   the flight from orbit into the cluster is continuous across windows */
export const CAMERAS = {
  hero: (p, t, rm) => ({ target: [0, 0, 0], az: 0.42 * (1 - e(p)) + (rm ? 0 : Math.sin(t * 0.07) * 0.5 * (1 - 0.8 * p)), el: lerp(0.98, 0.52, e(p)), dist: lerp(22, 14, e(p)), needW: 11 }),
  election: (p) => ({ target: [0, 0.2 * p, -0.5 * e(p)], az: 0.18 * e(p), el: lerp(0.52, 0.48, e(p)), dist: lerp(14, 10.5, e(p)), needW: 11.5 }),
  fault: (p) => ({ target: [-1.2, 0.1, 1.6], az: lerp(-0.3, -0.55, p), el: lerp(0.62, 0.5, p), dist: lerp(12.5, 11, p), needW: 10 }),
  consistency: (p) => ({ target: [0, 1.0, 0], az: lerp(0.18, -0.12, p), el: 0.46, dist: 13, needW: 11 }),
  integrity: (p, t, rm, aspect) => {
    const a = e(c01(p / 0.45)), r = c01((p - 0.86) / 0.14);
    return { target: [0, lerp(0, 0.3, a), lerp(2.5, 6.3, a)], az: lerp(0.3, 0, a), el: lerp(0.5, 0.15, a) + r * 0.06, dist: lerp(14, 10.5, a) + r * 5, needW: aspect < 0.95 ? 7.5 : 14 };
  },
};

export class Views {
  constructor({ canvas, world, palette, quality, header }) {
    this.world = world;
    this.palette = palette;
    this.quality = quality;
    this.header = header;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // tokens are already sRGB; no double encode
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120);
    this.targets = new Map();
    this.hud = document.getElementById("scene-hud");
    this.hudViews = new Map();

    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: screenVert,
      fragmentShader: postFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uMap: { value: null }, uGrain: { value: 0.05 }, uVignette: { value: 0.32 }, uChroma: { value: 0 },
        uExposure: { value: 1 }, uTime: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat));
    this.resize();
  }

  resize(dpr = this.renderer.getPixelRatio()) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  /** compile every program up front so the first scroll into a chapter never stalls */
  compile() { this.renderer.compile(this.world.scene, this.camera); this.renderer.compile(this.postScene, this.postCam); }

  begin() {
    this.renderer.setScissorTest(false);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setScissorTest(true);
    this.seen = new Set();
  }

  /** hide HUD containers for views that were not drawn this frame */
  end() { for (const [id, v] of this.hudViews) if (!this.seen.has(id)) v.el.hidden = true; }

  aim(chapter, p, t, rm, aspect, pointer) {
    const c = CAMERAS[chapter](p, t, rm, aspect);
    const tanH = Math.tan((FOV * Math.PI) / 360);
    const dist = Math.max(c.dist, c.needW / (2 * tanH * aspect));
    const az = c.az + (rm ? 0 : pointer.x * 0.05);
    const el = c.el + (rm ? 0 : pointer.y * 0.03);
    _t.fromArray(c.target);
    this.camera.position.set(_t.x + Math.sin(az) * Math.cos(el) * dist, _t.y + Math.sin(el) * dist, _t.z + Math.cos(az) * Math.cos(el) * dist);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(_t);
  }

  /** returns false when the window is not on screen */
  draw({ id, rect, chapter, progress, sim, t, rm, pointer, narrow }) {
    const headerBottom = this.header && !document.body.classList.contains("opening-active") ? this.header.getBoundingClientRect().bottom : 0;
    const x0 = Math.max(0, rect.left), x1 = Math.min(innerWidth, rect.right);
    const y0 = Math.max(headerBottom, rect.top), y1 = Math.min(innerHeight, rect.bottom);
    if (x1 - x0 < 2 || y1 - y0 < 2) return false;
    const w = rect.width, h = rect.height;
    const tier = this.quality.settings;
    const theme = this.palette[sim.theme];
    const r = this.renderer;

    // reduced motion shows the judged chain, not the receding exit frame
    this.aim(chapter, rm && chapter === "integrity" ? 0.84 : progress, t, rm, w / h, pointer);
    this.world.setTime(t);
    this.world.setResolution(w, h);
    sim.apply(this.world, this.quality.tier, w / h);

    const vx = rect.left, vy = innerHeight - rect.bottom;
    if (tier.post === "none") {
      r.setRenderTarget(null);
      r.setViewport(vx, vy, w, h);
      r.setScissor(x0, innerHeight - y1, x1 - x0, y1 - y0);
      r.setClearColor(theme.bg, 1);
      r.clear();
      r.render(this.world.scene, this.camera);
    } else {
      const dpr = r.getPixelRatio();
      const rt = this.#target(id, Math.round(w * dpr), Math.round(h * dpr), tier.msaa);
      r.setRenderTarget(rt);
      r.setScissorTest(false);
      r.setClearColor(theme.bg, 1);
      r.clear();
      r.render(this.world.scene, this.camera);
      r.setRenderTarget(null);
      r.setScissorTest(true);
      r.setViewport(vx, vy, w, h);
      r.setScissor(x0, innerHeight - y1, x1 - x0, y1 - y0);
      this.postMat.uniforms.uMap.value = rt.texture;
      this.postMat.uniforms.uTime.value = rm ? 0 : t;
      this.postMat.uniforms.uResolution.value.set(rt.width, rt.height);
      this.postMat.uniforms.uGrain.value = sim.theme === "ink" ? 0.07 : 0.04;
      this.postMat.uniforms.uVignette.value = sim.theme === "ink" ? 0.3 : 0.08;
      r.render(this.postScene, this.postCam);
    }
    this.#labels(id, sim, rect, { x0, y0, x1, y1 }, narrow);
    return true;
  }

  #target(id, w, h, samples) {
    let rt = this.targets.get(id);
    if (!rt || rt.samples !== samples) {
      rt?.dispose();
      rt = new THREE.WebGLRenderTarget(w, h, { samples, depthBuffer: true });
      this.targets.set(id, rt);
    } else if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    return rt;
  }

  #labels(id, sim, rect, clip, narrow) {
    let view = this.hudViews.get(id);
    if (!view) {
      const el = document.createElement("div");
      el.className = "hud-view";
      el.dataset.theme = sim.theme;
      this.hud.appendChild(el);
      view = { el, labels: new Map() };
      this.hudViews.set(id, view);
    }
    this.seen.add(id);
    view.el.hidden = false;
    view.el.style.transform = `translate3d(${clip.x0}px, ${clip.y0}px, 0)`;
    view.el.style.width = `${clip.x1 - clip.x0}px`;
    view.el.style.height = `${clip.y1 - clip.y0}px`;
    const compact = narrow;
    const specs = sim.labels(compact);
    const live = new Set();
    for (const s of specs) {
      live.add(s.key);
      let L = view.labels.get(s.key);
      if (!L) {
        const el = document.createElement("div");
        el.className = "hud-label";
        el.innerHTML = "<b></b><span></span>";
        view.el.appendChild(el);
        L = { el, b: el.firstChild, s: el.lastChild, title: "", sub: "", cls: "" };
        view.labels.set(s.key, L);
      }
      _v.copy(s.pos);
      _v.y += s.anchor === "block" ? -0.42 : -0.72;
      _v.project(this.camera);
      if (_v.z > 1) { L.el.hidden = true; continue; }
      const x = (_v.x * 0.5 + 0.5) * rect.width + rect.left - clip.x0;
      const y = (-_v.y * 0.5 + 0.5) * rect.height + rect.top - clip.y0;
      L.el.hidden = false;
      L.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, 0)`;
      if (L.title !== s.title) { L.title = s.title; L.b.textContent = s.title; }
      const sub = compact && s.anchor !== "block" ? "" : s.sub ?? "";
      if (L.sub !== sub) { L.sub = sub; L.s.textContent = sub; }
      const cls = `hud-label${s.dim ? " is-dim" : ""}${s.strong ? " is-strong" : ""}${s.tone ? ` is-${s.tone}` : ""}${s.anchor === "block" ? " is-block" : ""}`;
      if (L.cls !== cls) { L.cls = cls; L.el.className = cls; }
    }
    for (const [key, L] of view.labels) if (!live.has(key)) { L.el.remove(); view.labels.delete(key); }
  }
}
