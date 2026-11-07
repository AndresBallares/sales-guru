import { useId, useState } from 'react'
import type { PerformanceDailyPoint } from '../../lib/api'
import { formatInteger, formatMoney, formatRatio } from '../../lib/dashboardFormat'

type ChartMetric = 'spend' | 'purchases' | 'revenue' | 'costPerSale' | 'roas' | 'addToCart' | 'linkClicks'

const METRICS: { key: ChartMetric; label: string; format: (v: number) => string }[] = [
  { key: 'spend', label: 'Advertising Spend', format: formatMoney },
  { key: 'purchases', label: 'Purchases', format: formatInteger },
  { key: 'revenue', label: 'Revenue', format: formatMoney },
  { key: 'costPerSale', label: 'Cost Per Sale', format: formatMoney },
  { key: 'roas', label: 'ROAS', format: formatRatio },
  { key: 'addToCart', label: 'Add-to-Carts', format: formatInteger },
  { key: 'linkClicks', label: 'Link Clicks', format: formatInteger },
]

const WIDTH = 640
const HEIGHT = 240
const PAD = { left: 56, right: 16, top: 16, bottom: 28 }

// Days are UTC days, so a date is read and shown as UTC, whatever the browser's zone.
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// A line chart of one metric by day, from the real daily series. A day with no
// stored data is a gap in the line and is listed underneath; nothing is filled in.
export function TrendChart({
  daily,
  rangeLabel,
}: {
  daily: PerformanceDailyPoint[]
  // The period in words, lower-cased into "Showing the last 7 days".
  rangeLabel: string
}) {
  const [metricKey, setMetricKey] = useState<ChartMetric>('spend')
  const [active, setActive] = useState<number | null>(null)
  const selectId = useId()
  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0]

  const values = daily.map((d) => d[metric.key])
  const known = values.filter((v): v is number => v !== null)
  const gaps = daily.filter((_, i) => values[i] === null).map((d) => dayLabel(d.date))

  const top = known.length > 0 ? Math.max(...known) : 0
  const ceiling = top > 0 ? top : 1
  const plotWidth = WIDTH - PAD.left - PAD.right
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) =>
    PAD.left + (daily.length === 1 ? plotWidth / 2 : (i / (daily.length - 1)) * plotWidth)
  const y = (v: number) => PAD.top + plotHeight - (v / ceiling) * plotHeight

  // Consecutive known days are joined; a gap breaks the line.
  const segments: string[] = []
  let run: string[] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length > 1) segments.push(run.join(' '))
      run = []
    } else {
      run.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    }
  })
  if (run.length > 1) segments.push(run.join(' '))

  const activeValue = active === null ? null : values[active]

  return (
    <section className="perf-section" aria-labelledby="perf-trend-heading">
      <h3 id="perf-trend-heading" className="perf-section-title">
        Performance Over Time
      </h3>
      <p className="perf-section-sub">Understand how your advertising results change over time.</p>
      <div className="perf-trend-controls">
        <label htmlFor={selectId}>Metric</label>
        <select
          id={selectId}
          value={metricKey}
          onChange={(event) => {
            setMetricKey(event.target.value as ChartMetric)
            setActive(null)
          }}
        >
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="perf-trend-range">Showing the {rangeLabel.toLowerCase()}</span>
      </div>

      {known.length === 0 ? (
        <p className="perf-empty">
          No daily history yet for {metric.label} in this period. It fills in as Meta’s numbers are
          stored.
        </p>
      ) : (
        <div className="perf-chart">
          <div className="perf-chart-plot">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${metric.label} by day`}
            preserveAspectRatio="xMidYMid meet"
          >
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={y(ceiling * t)}
                  y2={y(ceiling * t)}
                  className="perf-chart-grid"
                />
                <text x={PAD.left - 8} y={y(ceiling * t) + 4} textAnchor="end" className="perf-chart-axis">
                  {metric.format(ceiling * t)}
                </text>
              </g>
            ))}
            {segments.map((points) => (
              <polyline key={points} points={points} className="perf-chart-line" />
            ))}
            {values.map((v, i) =>
              v === null ? null : (
                <circle key={daily[i].date} cx={x(i)} cy={y(v)} r={active === i ? 5 : 3.5} className="perf-chart-dot" />
              ),
            )}
            {[0, Math.floor((daily.length - 1) / 2), daily.length - 1]
              .filter((i, n, all) => all.indexOf(i) === n)
              .map((i) => (
                <text key={daily[i].date} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="perf-chart-axis">
                  {dayLabel(daily[i].date)}
                </text>
              ))}
          </svg>
          {values.map((v, i) =>
            v === null ? null : (
              <button
                key={daily[i].date}
                type="button"
                className="perf-chart-hit"
                style={{ left: `${(x(i) / WIDTH) * 100}%`, top: `${(y(v) / HEIGHT) * 100}%` }}
                aria-label={`${metric.label} on ${dayLabel(daily[i].date)}: ${metric.format(v)}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            ),
          )}
          {active !== null && activeValue !== null && (
            <div
              role="tooltip"
              className="perf-chart-tip"
              style={{
                left: `${(x(active) / WIDTH) * 100}%`,
                top: `${(y(activeValue) / HEIGHT) * 100}%`,
              }}
            >
              <strong>{dayLabel(daily[active].date)}</strong>
              <span>{metric.format(activeValue)}</span>
            </div>
          )}
          </div>
        </div>
      )}

      {gaps.length > 0 && known.length > 0 && (
        <p className="perf-chart-gaps">
          {gaps.length > 5
            ? `No data for ${gaps.length} of ${daily.length} days.`
            : `No data for ${gaps.join(', ')}.`}{' '}
          Those days are left as gaps, not shown as zero.
        </p>
      )}
    </section>
  )
}
