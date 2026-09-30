import { useLayoutEffect } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CustomEase } from 'gsap/CustomEase'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'

gsap.registerPlugin(ScrollTrigger, CustomEase, ScrollToPlugin)
// the four motion tokens from DESIGN.md (../tokens/semantic.css)
CustomEase.create('std', '.4,0,.2,1')
CustomEase.create('enter', '.16,1,.3,1')
CustomEase.create('exit', '.7,0,.84,0')
CustomEase.create('move', '.65,0,.35,1')

/** scene boundaries on the 0..10 timeline (and on the 0..1 scroll track) */
export const SCENES = [
  { id: 'capsule', label: 'CAPSULE', at: 0 },
  { id: 'overview', label: 'OVERVIEW', at: 3.65 },
  { id: 'burst', label: 'BURST', at: 8.95 },
  { id: 'enter', label: 'ENTER', at: 13.95 },
]
// Timeline units. Paced slowly on purpose: every change spans a long stretch of scroll
// (track = 1000vh) and scrub smoothing trails the wheel, so nothing snaps.
const TOTAL = 18

/* End states of each scene for the 3D stage — used as-is under reduced motion. */
const SCENE_STATE = [
  { capX: 0.34, capY: 0, capScale: 1, turn: 0.9, tilt: 0.55, orbit: 0, split: 0, burst: 0, ring: 0, labels: 0 },
  { capX: 0.46, capY: 0.28, capScale: 0.62, turn: 2.2, tilt: 0.3, orbit: 1, split: 0, burst: 0, ring: 0, labels: 1 },
  { capX: 0.3, capY: 0.02, capScale: 1.05, turn: 3.4, tilt: 1.35, orbit: 0, split: 1, burst: 1, ring: 0, labels: 0 },
  { capX: 0.32, capY: 0, capScale: 0.9, turn: 4.4, tilt: 1.45, orbit: 0, split: 1.25, burst: 1, ring: 1, labels: 1 },
]

/**
 * Builds the ONE scrubbed timeline that drives both the DOM copy and the 3D state.
 * The document height comes from the invisible track; the stage itself is fixed.
 */
export default function useScrollStory({ root, track, state, onScene, onProgress, reducedMotion }) {
  useLayoutEffect(() => {
    const q = (sel) => root.current.querySelectorAll(sel)
    const scenes = [...q('[data-scene]')]
    const sceneAt = (p) => SCENES.reduce((acc, s, i) => (p * TOTAL >= s.at - 0.4 ? i : acc), 0)

    const ctx = gsap.context(() => {
      if (reducedMotion) {
        // No scrub, no movement: snap to scene end states, 120ms opacity swap only.
        const show = (i) => {
          scenes.forEach((el, k) => gsap.to(el, { autoAlpha: k === i ? 1 : 0, duration: 0.12, ease: 'std' }))
          gsap.to(q('.backdrop-waves'), { autoAlpha: i === 0 ? 1 : 0, duration: 0.12, ease: 'std' })
          gsap.to(q('.backdrop-threads'), { autoAlpha: i === 1 ? 1 : 0, duration: 0.12, ease: 'std' })
          gsap.set(q('.line-inner, .reveal'), { yPercent: 0, y: 0, autoAlpha: 1 })
          Object.assign(state, SCENE_STATE[i], { intro: 1 })
          onScene(i)
        }
        show(0)
        ScrollTrigger.create({
          trigger: track.current, start: 'top top', end: 'bottom bottom',
          onUpdate: (self) => { onProgress(self.progress); const i = sceneAt(self.progress); if (i !== show.last) { show.last = i; show(i) } },
        })
        return
      }

      // ── intro (load, not scroll): the capsule arrives, the first lines rise ──
      // The hero (scene 01) enters with a CSS animation (styles.css → .scene-capsule),
      // which runs on the compositor: it paints while the main thread is still compiling
      // shaders, instead of waiting for the ticker. Only scenes 02–04 are pre-hidden here.
      const later = scenes.slice(1)
      gsap.set(later, { autoAlpha: 0 })
      later.forEach((el) => {
        gsap.set(el.querySelectorAll('.line-inner'), { yPercent: 110 })
        gsap.set(el.querySelectorAll('.reveal'), { autoAlpha: 0, y: 24 })
      })
      gsap.set(q('.backdrop-threads'), { autoAlpha: 0 })
      gsap.to(state, { intro: 1, duration: 1.4, ease: 'enter', delay: 0.2 })

      // ── the scroll story ──
      const tl = gsap.timeline({
        defaults: { ease: 'move' },
        scrollTrigger: {
          // Lenis already smooths the scroll itself; a short scrub just rounds off the edges
          trigger: track.current, start: 'top top', end: 'bottom bottom', scrub: 0.6,
          onUpdate: (self) => { onProgress(self.progress); onScene(sceneAt(self.progress)) },
        },
      })
      const enterLines = (el, at) => tl
        .set(el, { autoAlpha: 1 }, at)
        .to(el.querySelectorAll('.line-inner'), { yPercent: 0, duration: 1.3, stagger: 0.12, ease: 'enter' }, at)
        .to(el.querySelectorAll('.reveal'), { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.14, ease: 'enter' }, at + 0.5)
      // explicit from-values: the hero's lines are revealed by the intro, not by this
      // timeline, so a plain .to() would record them as hidden and never bring them back
      const exitScene = (el, at) => tl
        .fromTo(el.querySelectorAll('.line-inner'), { yPercent: 0 }, { yPercent: -110, duration: 1.1, stagger: 0.08, ease: 'exit', immediateRender: false }, at)
        .fromTo(el.querySelectorAll('.reveal'), { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -16, duration: 0.9, stagger: 0.06, ease: 'exit', immediateRender: false }, at)
        .set(el, { autoAlpha: 0 }, at + 1.5)

      const [s1, s2, s3, s4] = scenes
      // CAPSULE — a long hold while the capsule turns under the scroll
      tl.to(state, { turn: SCENE_STATE[0].turn, duration: 3 }, 0)
      exitScene(s1, 2.6)
      // OVERVIEW — capsule steps back up-right, the six node-capsules drift into orbit
      tl.to(state, { ...pick(SCENE_STATE[1], 'capX capY capScale turn tilt'), duration: 2.2 }, 2.8)
        .to(state, { orbit: 1, labels: 1, duration: 2.0, ease: 'enter' }, 3.4)
      // backdrops cross-fade with the story: waves → threads → plain paper
      tl.to(q('.backdrop-waves'), { autoAlpha: 0, duration: 1.2, ease: 'std' }, 2.8)
        .to(q('.backdrop-threads'), { autoAlpha: 1, duration: 1.4, ease: 'std' }, 3.2)
      enterLines(s2, 3.65)
      exitScene(s2, 7.6)
      tl.to(q('.backdrop-threads'), { autoAlpha: 0, duration: 1.2, ease: 'std' }, 7.8)
      // BURST — orbiters fold back into the capsule, it lays down, then slowly opens
      tl.to(state, { orbit: 0, labels: 0, duration: 1.6, ease: 'exit' }, 7.8)
        .to(state, { ...pick(SCENE_STATE[2], 'capX capY capScale tilt'), turn: 3.4, duration: 2.0 }, 8.0)
        .to(state, { split: 1, duration: 2.0, ease: 'enter' }, 9.6)
        .to(state, { burst: 1, duration: 2.4, ease: 'enter' }, 9.8)
      enterLines(s3, 8.95)
      exitScene(s3, 12.6)
      // ENTER — the contents gather into the six nodes
      tl.to(state, { ...pick(SCENE_STATE[3], 'capX capY capScale turn tilt split'), duration: 2.0 }, 12.8)
        .to(state, { ring: 1, labels: 1, duration: 2.4, ease: 'move' }, 13.0)
      enterLines(s4, 13.95)
      tl.to({}, { duration: 1.4 }, 16.6)    // a calm hold before the track ends
    }, root)
    return () => ctx.revert()
  }, [reducedMotion])   // eslint-disable-line react-hooks/exhaustive-deps
}

const pick = (o, keys) => Object.fromEntries(keys.split(' ').map((k) => [k, o[k]]))
export const sceneStart = (i) => SCENES[i].at / TOTAL
