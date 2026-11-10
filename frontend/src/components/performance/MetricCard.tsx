import { useId, type ReactNode } from 'react'
import { METRIC_COPY, type MetricKey } from '../../lib/metricCopy'
import { InfoTip } from './InfoTip'
import { MetricIcon } from './MetricIcon'

export type Polarity = 'higher' | 'lower' | 'neutral'

// How the number moved from the previous period, in words. Shown only when both
// figures are known and the previous one is not zero (a change from nothing has
// no meaningful percentage), and coloured good or bad only for metrics where one
// direction is clearly better.
export function Delta({
  current,
  previous,
  polarity,
  label,
}: {
  current: number | null
  previous: number | null | undefined
  polarity: Polarity
  label: string
}) {
  if (current === null || previous === null || previous === undefined || previous === 0) {
    return null
  }
  const change = ((current - previous) / Math.abs(previous)) * 100
  const rounded = Math.abs(change).toFixed(1)
  const unchanged = rounded === '0.0'
  const direction = unchanged ? 'No change' : change > 0 ? `Up ${rounded}%` : `Down ${rounded}%`
  const better =
    polarity === 'neutral' || unchanged ? null : (change > 0) === (polarity === 'higher')
  const tone = better === null ? 'neutral' : better ? 'good' : 'bad'
  const way = unchanged ? 'flat' : change > 0 ? 'up' : 'down'
  return (
    <p className={`perf-delta perf-delta-${tone}`}>
      <span className="perf-delta-arrow" data-direction={way} aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          {way === 'up' && <path d="M12 19V5M6 11l6-6 6 6" />}
          {way === 'down' && <path d="M12 5v14M6 13l6 6 6-6" />}
          {way === 'flat' && <path d="M5 12h14" />}
        </svg>
      </span>
      {direction} from the {label}
    </p>
  )
}

// One metric: its icon in a tinted circle at the left, and beside it the name with its info
// icon, the number, the change from the previous period and a plain-English note. The number is
// the most prominent thing on the card; the icon is the first thing the eye recognises.
export function MetricCard({
  metric,
  title,
  value,
  note,
  primary = false,
  delta,
}: {
  metric: MetricKey
  // Overrides the metric's usual name where a section words it differently.
  title?: string
  value: string
  // Replaces the standard one-line explanation when the number has its own.
  note?: ReactNode
  primary?: boolean
  delta?: ReactNode
}) {
  const headingId = useId()
  return (
    <article
      className={`perf-card${primary ? ' perf-card-primary' : ''}`}
      aria-labelledby={headingId}
    >
      <MetricIcon metric={metric} />
      <div className="perf-card-body">
        <div className="perf-card-head">
          <h3 id={headingId}>{title ?? METRIC_COPY[metric].name}</h3>
          <InfoTip metric={metric} />
        </div>
        <p className="perf-value">{value}</p>
        {delta}
        <p className="perf-note">{note ?? METRIC_COPY[metric].plain}</p>
      </div>
    </article>
  )
}
