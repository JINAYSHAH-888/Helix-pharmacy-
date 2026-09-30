import { useEffect, useRef, useState } from 'react'

/* ThreeUI GlassAiButton (three r170 + GLSL, source SHA-256 a484571de316) hosted in an
   opaque allow-scripts sandbox. The host <a> owns focus, clicks and navigation; it tells
   the scene to burst, waits for it, then navigates. The iframe unmounts while hidden. */
export default function GlassAiButton({ href, label, delay = 650, className = '' }) {
  const frame = useRef(null)
  const host = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let inView = false
    const sync = () => setVisible(inView && !document.hidden)
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync() })
    io.observe(host.current)
    document.addEventListener('visibilitychange', sync)
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', sync) }
  }, [])
  const send = (m) => frame.current?.contentWindow?.postMessage(m, '*')
  const go = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    e.preventDefault(); send('glass:burst')
    setTimeout(() => { location.href = e.currentTarget?.href || href }, delay)
  }
  const src = `${import.meta.env.BASE_URL}glass-ai-button.html?label=${encodeURIComponent(label)}`
  return (
    <a ref={host} href={href} className={`glass-ai ${className}`} aria-label={label}
       onClick={go} onPointerEnter={() => send('glass:hover')} onPointerLeave={() => send('glass:leave')}
       onFocus={() => send('glass:hover')} onBlur={() => send('glass:leave')}>
      {visible && <iframe ref={frame} src={src} sandbox="allow-scripts" title="" tabIndex={-1} aria-hidden="true" />}
    </a>
  )
}
