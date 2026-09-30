import { useEffect } from 'react'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

/**
 * Smooth, momentum scrolling for the landing page (Lenis), driven by GSAP's ticker so
 * the scroll position, the ScrollTrigger timeline and the three.js frame all advance in
 * the SAME tick — no one-frame lag between the copy and the capsule.
 * Native scroll is kept underneath: keyboard, scrollbar and Find-in-page still work.
 * Reduced motion: Lenis is not started at all (plain native scroll).
 */
export default function useSmoothScroll(reducedMotion) {
  useEffect(() => {
    if (reducedMotion) return undefined
    const lenis = new Lenis({
      duration: 1.25,                                   // glide time for a wheel flick
      easing: (t) => 1 - Math.pow(1 - t, 4),            // soft ease-out, no bounce
      wheelMultiplier: 0.9,
      touchMultiplier: 1.4,
      smoothWheel: true,
    })
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (time) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)                         // never skip frames while gliding
    window.__lenis = lenis                              // lets the scene jump buttons/tests use it
    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
      delete window.__lenis
    }
  }, [reducedMotion])
}
