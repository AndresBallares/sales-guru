import { useId } from 'react'
import type { StyleKey } from '../../lib/metricStyle'
import { MetricIcon } from './MetricIcon'

// Three terms explained in the plainest words, for owners who do not know advertising jargon. Each
// has the same icon and colour as its metric card (lib/metricStyle.ts), so they are recognised at once.
const ROWS: { metric: StyleKey; name: string; text: string }[] = [
  { metric: 'impressions', name: 'Impressions', text: 'Shows how often your ads are seen.' },
  {
    metric: 'addToCart',
    name: 'Add to Cart',
    text: 'Tells you how many people show interest by adding products to their cart.',
  },
  { metric: 'cac', name: 'CAC', text: 'Shows how much it costs to acquire a customer.' },
]

export function WhatThisMeans() {
  const headingId = useId()
  return (
    <section className="perf-section perf-means" aria-labelledby={headingId}>
      <div className="perf-section-heading">
        <MetricIcon metric="insight" size="heading" />
        <h3 id={headingId} className="perf-section-title">
          What this means
        </h3>
      </div>
      <ul className="perf-means-list">
        {ROWS.map((row) => (
          <li key={row.metric} className="perf-means-row">
            <MetricIcon metric={row.metric} size="row" />
            <div>
              <strong>{row.name}</strong>
              <p>{row.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
