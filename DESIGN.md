# DESIGN.md

Contract for the Helixis distributed-pharmacy control room. Every other file
reads this. Amend it before contradicting it.

## Direction
- **Archetype:** engineered-precision
- **One-line intent:** A measuring instrument for a six-node Java RMI cluster —
  the page shows the distributed system *working* (election, failover, vector
  clocks, hash chain) and labels every moving part, so a distributed-computing
  professor can read the protocol off the screen.
- **Signature move:** one persistent real-time WebGL cluster that never stops
  running. Scroll moves the camera and the narrative (`scrub`); time keeps the
  nodes pulsing, messages flowing, clocks ticking and prescription 017's hash
  glitching (`update`). Every 3D element is labelled in mono.
- **Risk budget:** medium — expressive scene, sober console. The scene is the
  only spectacle; the labs and tables stay quiet.
- **Audience:** distributed-computing professor + technical peers.
- **Reference feel (not to copy):** oscilloscope front panels, Teenage
  Engineering spec sheets, printed RFC diagrams.
- **Deliberate deviations from the archetype default (amended, not drift):**
  1. Neutrals are **warm** (hue 107, the existing paper/ink), not cool 240–260 —
     the warm-white/black-ink direction predates this contract and is kept.
  2. Playfair Display italic survives as the one editorial accent inside H2s.
  3. Radius stays 0–4px; the old 145px capsule radius is retired with the
     frame sequence.

## Legibility rule (hard)
If a professor cannot say what a visual represents, it is cut. No abstract
blobs, no generic particle fields, no decorative orbit rings. Each scene
element maps to one system concept:

| Scene element | Represents | Source of truth |
|---|---|---|
| Six hex-prism nodes, mono label `N0x · CITY · :port` | RMI registries 1099–1104 | `/api/network` (reachable, coordinator) |
| Edge + travelling pulse | one RMI message on that link | modelled; rate shown in HUD |
| Crown ring around a node | bully coordinator (highest alive ID) | `/api/network.coordinator`, else model |
| Node shell goes dark, edges drop | crash-stop failure | `/api/fault-tolerance` phase when live |
| Stacked counters above nodes `[a,b,c,d,e,f]` | vector clock per node | modelled, merge rule shown |
| Chain of blocks, hash under each | SHA-256 prescription chain | `/api/prescriptions` + `crypto.subtle` in browser |
| Glitching block, danger colour | prescription 017 tamper | the only red on the page |

Measured vs modelled is always labelled: `LIVE` (from the gateway) or `MODEL`
(client-side simulation). Latency shown is the measured gateway round trip; the
backend does not expose per-node RMI latency, so none is invented.

## Color (OKLCH)
- **Space:** oklch, sRGB-gamut-mapped by `gen-palette.mjs`; hex fallbacks in
  `tokens/*.css` under `@supports not (color: oklch(0% 0 0))`.
- **Neutral hue:** 107, chroma 0.009 (tinted, never pure grey). Ramp `--n-1…12`
  in `tokens/color-neutral.css`.
- **Status ramps:** `--good-*` hue 152 · `--warn-*` hue 80 · `--danger-*` hue 24,
  chroma 0.06 / 0.08 / 0.12, 12 Radix steps each.
- **Semantic anchors (preserve the values already shipped):**

| Token | OKLCH | was | Use |
|---|---|---|---|
| `--paper` | `oklch(96.9% 0.0066 106.5)` | #F5F5F0 | page background |
| `--paper-deep` | `oklch(93.2% 0.0093 106.6)` | #E9E9E2 | fault-lab band |
| `--panel` | `oklch(94.7% 0.0080 106.6)` | #EEEEE8 | hover / inset surfaces |
| `--ink` | `oklch(19.5% 0.0059 106.9)` | #151512 | text, dark bands, primary action |
| `--line` | `oklch(86.4% 0.0122 106.7)` | #D3D3CA | every border |
| `--muted` | `oklch(49.5% 0.0105 106.8)` | #6D6D66 → **darkened** | secondary text |
| `--dark-line` | `oklch(35.8% 0.0118 107)` | #3D3D36 | borders on ink |
| `--dark-muted` | `oklch(80% 0.0120 107)` | #9C9C93 → **lightened** | secondary text on ink |
| `--good` | `--good-11` `oklch(51.2% …152)` | #607565 | healthy / acknowledged |
| `--warn` | `--warn-11` `oklch(51.2% …80)` | #8D7650 → **darkened** | pending / lagging |
| `--danger` | `--danger-11` `oklch(51.2% …24)` | #925D59 | **prescription 017 only** |
| `--good-on-dark` / `--warn-on-dark` | step 11 of the dark ramp | — | status on ink |

- **Contrast fixes applied (report FAILs → fixed before writing CSS):**
  - `#8D7650` warn text on paper 3.97:1 **FAIL** → `--warn-11` 5.22:1.
  - `#6D6D66` muted on paper-deep 4.27:1 **FAIL** → `oklch(49.5%)` 5.03:1 (5.61:1 on paper, APCA Lc 74).
  - `#9C9C93` on ink APCA Lc 48 (weak for 16px body) → `oklch(80%)` WCAG 9.78:1, Lc 66 (≥60 large-text; secondary copy only).
  - `#607565` good 4.54:1 (knife-edge) → `--good-11` 5.07:1.
- **Contrast floor:** WCAG 2.2 AA (4.5:1 text, 3:1 UI); APCA Lc ≥ 75 body on paper.
- **Danger is reserved.** `--danger-*` appears in exactly one place: the
  prescription 017 tamper state (scene block, chain label, integrity readout,
  its row in the explorer). Every other failure state — offline node, conflict,
  stale read, blocked write — uses `--ink` weight + a struck/hollow marker +
  `--warn`. A second red anywhere is a bug.
- **Forbidden:** pure #000/#fff, untinted greys, gradients as decoration,
  a second accent hue, rgb()/hex literals outside `tokens/`.

## Type
- **Display:** Manrope 600, tracking `--ls-10` (−0.054em) → tightened to −0.06em for H2 only.
- **Editorial accent:** Playfair Display italic 400 — one phrase per H2, never elsewhere.
- **Body:** Manrope 400/500/600.
- **Mono:** DM Mono 400/500 — **every** hash, node ID, port, timestamp, latency,
  term, version, vector clock and label. `font-variant-numeric: tabular-nums`
  on all mono and all numeric cells.
- **Scale:** ratio 1.2 (desktop) / 1.14 (320px), 13 steps, `tokens/type.css`.
  Labels `--step--2` (11.1px, never smaller — the old 8–9px labels are retired),
  UI `--step--1` (13.3px), body `--step-0` (16px), H3 `--step-3`, lab readouts
  `--step-5`, H2 `--step-10` (59→99px).
- **Labels:** uppercase mono, `letter-spacing: .08em`.
- **Measure:** body ≤ 62ch; H2 ≤ 12ch.
- **Forbidden:** Inter, Roboto, Arial, system-ui as display.

## Space & shape
- **Spacing scale:** 4 8 12 16 24 32 48 64 96 128 192 (`--s-1…--s-11`).
- **Radius:** `--r-0: 0`, `--r-1: 2px`, `--r-2: 4px`. Nothing above 4px except status dots.
- **Border:** 1px solid `--line` (paper) / `--dark-line` (ink). Borders define every surface.
- **Elevation:** none. No drop shadows anywhere, including the dialog. Depth = value contrast.
- **Grid:** 12 col, max 1370px, gutter 56px desktop / 28px ≤900 / 20px ≤700.
- **Corner ticks:** 8px L-marks at the corners of every scene window and lab console.
- **Section rhythm (deliberately uneven):**

| # | Section | Band | Density | Width | Height |
|---|---|---|---|---|---|
| 00 | Hero cluster (pinned) | paper, full-bleed scene | sparse | full | 100vh pinned + 120vh scrub |
| 01 | System view | paper | medium | shell | auto |
| 02 | Node layer + election window | ink | sparse → dense | shell, window 7/12 | 90vh window |
| 02A | Fault lab + failover window | paper-deep | dense | window full-shell | 70vh window |
| 02B | Consistency lab + clocks window | paper | dense | window 5/12 left | 80vh window |
| 02C | Integrity (hash chain) | ink | sparse | full-bleed window | 90vh window |
| 03 | Data explorer — canvas recedes | paper | densest | shell | auto |
| 04 | Protocol | ink | sparse | shell | auto |
| 05 | Database map | paper | medium | shell | auto |

Never a centred hero with feature cards. The hero is a left-aligned mono
spec block over a full-bleed live cluster.

## Motion
- **Durations:** `--d-fast: 120ms` · `--d-base: 180ms` · `--d-slow: 480ms` · `--d-cine: 900ms`.
- **Easings (exactly 4):**
  - `--e-std: cubic-bezier(.4,0,.2,1)` — state changes (hover, toggle, value shift)
  - `--e-enter: cubic-bezier(.16,1,.3,1)` — arrivals (reveals, dialog open)
  - `--e-exit: cubic-bezier(.7,0,.84,0)` — departures (dialog close)
  - `--e-move: cubic-bezier(.65,0,.35,1)` — spatial repositioning (camera, chain assembly)
  GSAP uses the same four via `CustomEase`; GLSL uses `easeInOutCubic` ≈ `--e-move`.
- **Stagger:** rows .04s · cards .06s · total ≤ 600ms.
- **Scene split:** `scrub(progress)` = camera path, chapter phase, chain assembly.
  `update(t, dt)` = node pulse, edge message flow, vector-clock increments,
  017 glitch, coordinator heartbeat. Stopping scroll never stops the scene.
- **Reduced-motion:** no ScrollSmoother, no pin, no scrub. Every scene window
  renders its **final chapter state** immediately (leader crowned, fault
  recovered, conflict resolved, chain built with 017 broken), with pulses and
  glitch frozen to a legible still. CSS reveals collapse to a 120ms opacity
  fade. The existing blanket `prefers-reduced-motion` block stays.
- **will-change:** set at animation start, removed on complete. Never permanent.

## Interaction
- **Scroll:** native scrollbar; ScrollSmoother `smooth: 1.1`, `normalizeScroll: false`
  (keyboard, Find-in-page and Space/PageDown/Home/End must work). Hero pin:
  `pinSpacing: true`, `pinType: "transform"`, distance from `--scene-scroll`
  on `.tablet-scene`. Skip link always visible during the pin.
- **Progress signal:** every scene window has a mono chapter rail (01/02/03…)
  showing the active phase.
- **Cursor:** default. **Hover:** value shift (border/ink), never scale.
- **Targets:** ≥ 24px (WCAG 2.5.8); primary controls 40px.
- **Keyboard:** `<kbd>` hints beside lab actions; all labs keyboard-complete.
- **Hero:** WebGL — one persistent canvas, one RAF (`engine/Time.js`), views
  scissored into DOM windows (scroll-rig pattern).

## Budgets
- JS ≤ 150KB gz first-party+libs excluding three.js; three.module.min ≈ 170KB gz loaded as module.
- CSS ≤ 60KB · fonts ≤ 120KB / 3 families (existing).
- LCP ≤ 2.0s · INP ≤ 160ms · CLS ≤ 0.08.
- WebGL: scene assets < 2MB (no textures, no models — all procedural geometry),
  ≥ 50fps p95 mid-tier Android, adaptive quality on (`engine/Quality.js`),
  static SVG poster fallback when WebGL is unavailable, idle when tab hidden.

## Verification
- **Rubric:** default (verification skill), 100 pts.
- **Pass threshold:** 80/100, no category below 3/5.
- **Viewports:** 390×844, 768×1024, 1440×900.

## Amendment — glass buttons (requested by the owner)
Every action button on both pages uses the **glass galaxy button** look, adapted
from ThreeUI `GlassAiButton` (source SHA-256 a484571de316, studied in full):
translucent deep-blue glass pill, bright rim, curved specular sheen, a spinning
spiral-galaxy orb on the left, white label, particle burst + light ring on press.
- Overrides for buttons only: blur/glass and a pill radius (999px) are allowed;
  a soft outer glow is allowed on the glass. Everything else keeps the rules above.
- New accent hue: glass blue, hue 262 (`--glass-*` tokens in tokens/semantic.css).
- The original is one full three.js scene per button (740 KB, one WebGL context
  each); browsers cap ~16 contexts, so the look is rebuilt in CSS with ONE shared
  2D canvas for the bursts (`glass/glass.js`). Links stay links: the burst plays,
  then navigation follows ~280 ms later (instant with modifier keys / reduced motion).
