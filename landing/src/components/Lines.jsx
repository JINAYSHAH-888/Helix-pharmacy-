/**
 * Masked text lines. Each line is clipped by its wrapper so the scroll timeline can
 * slide it up into view (and out again) — copy never just sits on the page.
 * Lines are authored explicitly, so breaks are deliberate at every width.
 */
export default function Lines({ as: Tag = 'p', lines, className = '', id }) {
  return (
    <Tag className={`lines ${className}`} id={id}>
      {lines.map((line, i) => (
        <span className="line" key={i}>
          <span className="line-inner">{line}</span>
        </span>
      ))}
    </Tag>
  )
}
