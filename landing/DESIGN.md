# DESIGN.md — Helixis landing

Extends `../DESIGN.md` (tokens, type scale, four easings, borders-not-shadows,
radius 0–4px, mono for every machine value). Only what differs is written here.

## Direction
- **Archetype:** engineered-precision (same brand as the control room), risk budget **high** — this is the front door, not the console.
- **One-line intent:** One capsule carries the whole system. Scroll turns it, shows what it contains, then breaks it open — and the contents become the six-node network.
- **Signature move:** the supplied capsule model (`public/models/capsule.glb`, two real halves `Upper_Cap` / `Lower_Cap`) is the only hero object; the burst physically separates those halves along their shared axis.
- **Never:** centred hero with three feature cards and a gradient CTA; stock pills; abstract particle fog. Every granule that bursts out re-forms into the six labelled nodes.

## Layout
- The document never visibly scrolls. One fixed 100svh stage; a 560vh invisible track under it feeds native scroll (keyboard, scrollbar, Find still work) into one scrubbed GSAP timeline.
- Four scenes on that timeline: **01 Capsule** (0–18%), **02 Overview** (18–50%), **03 Burst** (50–80%), **04 Enter** (80–100%).
- Copy is left-aligned in a 5/12 column; the capsule owns the remaining 7/12 and moves between scenes. Mono scene rail on the right edge is the progress signal and a jump menu.

## Colour / type
- Tokens imported from `../tokens/*.css`. Capsule: upper cap `--ink`, lower cap `--paper`, both clear-coated. Granules `--paper` + `--ink`. No red on this page (red belongs to prescription 017 in the console).
- Display H1 `--step-10`, Playfair italic accent once per heading. Labels mono `--label-size`, `.08em`.

## Motion
- Easings: the four tokens only (`std`, `enter`, `exit`, `move` via CustomEase).
- **scrub(progress)**: capsule position/scale/rotation offsets, orbit radius, split distance, burst radius, ring formation, text line reveals.
- **update(t, dt)**: capsule idle spin + float, orbiting node-capsules keep circling, granules keep drifting. Stopping the scroll never freezes the stage.
- Text never pre-exists: every line is masked and revealed by the timeline as its scene arrives, and exits before the next.
- **Reduced motion:** no scrub. Scroll position snaps between the four scenes with a 120ms opacity swap; the 3D stage shows each scene's end state, idle motion frozen.

## Budgets
- JS ≤ 150KB gz first-party (three + gsap vendored in the bundle, reported separately) · model 176KB · no textures (RoomEnvironment is procedural).
- ≥ 50fps p95, adaptive DPR via `../engine/Quality.js`, WebGL-less fallback = static capsule SVG + all copy visible.
