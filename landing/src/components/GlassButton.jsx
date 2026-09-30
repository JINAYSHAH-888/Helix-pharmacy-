// Glass galaxy button for the landing page — the same look and burst engine as the
// control room (../../glass), adapted from ThreeUI GlassAiButton (see DESIGN.md).
import { useEffect, useRef } from 'react'
import { enhance } from '../../../glass/glass.js'
import '../../../glass/glass.css'

export default function GlassButton({ href, size, children, className = '', ...rest }) {
  const ref = useRef(null)
  useEffect(() => { enhance(ref.current, { size }) }, [size])
  const Tag = href ? 'a' : 'button'
  return (
    <Tag ref={ref} href={href} type={href ? undefined : 'button'} className={className} {...rest}>
      {children}
    </Tag>
  )
}
