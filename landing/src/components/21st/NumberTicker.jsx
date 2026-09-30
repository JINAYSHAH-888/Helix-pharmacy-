// 21st.dev — "Number Ticker" by danielpetho (id 20459). Ported from TS to JSX.
// Local edits: no shadcn `cn` helper; default transition uses the --e-move curve;
// reduced motion jumps straight to the target; startAnimation reads current props
// (the original captured the first render's from/target in a stale useCallback).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'

const NumberTicker = forwardRef(function NumberTicker(
  {
    from = 0,
    target = 100,
    transition = { duration: 1.4, type: 'tween', ease: [0.65, 0, 0.35, 1] },
    className = '',
    onStart,
    onComplete,
    autoStart = true,
    ...props
  },
  ref,
) {
  const count = useMotionValue(from)
  const rounded = useTransform(count, (latest) => Math.round(latest))
  const controls = useRef(null)
  const latest = useRef({ from, target, transition, onStart, onComplete })
  latest.current = { from, target, transition, onStart, onComplete }

  const startAnimation = useCallback(() => {
    const p = latest.current
    controls.current?.stop()
    p.onStart?.()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      count.set(p.target)
      p.onComplete?.()
      return
    }
    count.set(p.from)
    controls.current = animate(count, p.target, { ...p.transition, onComplete: () => p.onComplete?.() })
  }, [count])

  useImperativeHandle(ref, () => ({ startAnimation }), [startAnimation])

  useEffect(() => {
    if (autoStart) startAnimation()
    return () => controls.current?.stop()
  }, [autoStart, startAnimation])

  return (
    <motion.span className={className} {...props}>
      {rounded}
    </motion.span>
  )
})

export default NumberTicker
