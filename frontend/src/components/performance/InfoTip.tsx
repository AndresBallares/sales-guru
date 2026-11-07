import { useEffect, useId, useRef, useState } from 'react'
import { METRIC_COPY, type MetricKey } from '../../lib/metricCopy'

// The small "i" next to a metric name. Hovering or focusing it shows the
// explanation; clicking pins it open (for touch screens) until clicked again,
// Escape, or a click elsewhere.
export function InfoTip({ metric }: { metric: MetricKey }) {
  const copy = METRIC_COPY[metric]
  const tipId = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const open = pinned || hovered || focused

  function close() {
    setPinned(false)
    setHovered(false)
    setFocused(false)
  }

  useEffect(() => {
    if (!pinned) return
    function onPointerDown(event: MouseEvent) {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [pinned])

  return (
    <span className="perf-tip" ref={wrapper}>
      <button
        type="button"
        className="perf-tip-button"
        aria-label={`About ${copy.name}`}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => (pinned ? close() : setPinned(true))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="7.25" y="7" width="1.5" height="4.5" rx="0.75" fill="currentColor" />
          <circle cx="8" cy="4.75" r="0.9" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <span role="tooltip" id={tipId} className="perf-tip-body">
          <strong className="perf-tip-what">{copy.what}</strong>
          <span className="perf-tip-label">In plain English</span>
          <span>{copy.plain}</span>
          <span className="perf-tip-label">Why it matters</span>
          <span>{copy.why}</span>
          <span className="perf-tip-label">How to read it</span>
          <span>{copy.how}</span>
        </span>
      )}
    </span>
  )
}
