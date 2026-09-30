/**
 * Design tokens → values the WebGL components can consume.
 * React Bits' ogl components parse `#rrggbb`; our tokens are oklch(). Resolve
 * through a 1px canvas so every colour on the page still comes from tokens/*.css.
 */
let probe
export function tokenHex(name) {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = value || 'transparent'
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
