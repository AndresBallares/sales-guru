import { useId, type ReactNode } from 'react'
import { METRIC_COPY, type MetricKey } from '../../lib/metricCopy'
import { InfoTip } from './InfoTip'

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
  return (
    <p className={`perf-delta perf-delta-${tone}`}>
      {direction} from the {label}
    </p>
  )
}

// One metric: its name and info icon, the number, and a plain-English note.
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
      <div className="perf-card-head">
        <h3 id={headingId}>{title ?? METRIC_COPY[metric].name}</h3>
        <InfoTip metric={metric} />
      </div>
      <p className="perf-value">{value}</p>
      {delta}
      <p className="perf-note">{note ?? METRIC_COPY[metric].plain}</p>
    </article>
  )
}
