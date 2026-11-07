import type { PerformanceFunnelKey, PerformanceFunnelStage } from '../../lib/api'
import { UNAVAILABLE, formatInteger, formatMoney, formatPercent } from '../../lib/dashboardFormat'
import { METRIC_COPY, type MetricKey } from '../../lib/metricCopy'
import { InfoTip } from './InfoTip'

interface StageCopy {
  label: string
  metric: MetricKey
  // What the conversion percentage is a share of.
  of: string | null
  // How the step is named in the "biggest drop" sentence.
  short: string
}

const STAGES: Record<PerformanceFunnelKey, StageCopy> = {
  landing_page_views: { label: 'Landing Page Views', metric: 'landingPageViews', of: null, short: 'landing page views' },
  add_to_cart: { label: 'Added to Cart', metric: 'addToCart', of: 'landing page views', short: 'added to cart' },
  initiated_checkout: { label: 'Started Checkout', metric: 'initiatedCheckout', of: 'people who added to cart', short: 'started checkout' },
  purchases: { label: 'Purchases', metric: 'purchases', of: 'people who started checkout', short: 'purchases' },
  revenue: { label: 'Purchase Revenue', metric: 'purchaseRevenue', of: null, short: 'revenue' },
}

function biggestDrop(stages: PerformanceFunnelStage[]): string | null {
  let worst: { from: string; to: string; rate: number } | null = null
  stages.forEach((stage, index) => {
    if (index === 0 || stage.key === 'revenue' || stage.rateFromPrevious === null) return
    if (worst === null || stage.rateFromPrevious < worst.rate) {
      worst = {
        from: STAGES[stages[index - 1].key].short,
        to: STAGES[stage.key].short,
        rate: stage.rateFromPrevious,
      }
    }
  })
  if (worst === null) return null
  const { from, to, rate } = worst as { from: string; to: string; rate: number }
  return `Most people drop off between ${from} and ${to} (${formatPercent(100 - rate)} don’t continue).`
}

function count(stage: PerformanceFunnelStage): string {
  return stage.key === 'revenue' ? formatMoney(stage.count) : formatInteger(stage.count)
}

// From click to customer: a left-to-right journey on wide screens, stacked on
// small ones. A step Meta has not reported is a dash and "Not reported", and a
// step after it gets no percentage, so a gap never reads as a 0% conversion.
export function FunnelSection({ funnel }: { funnel: PerformanceFunnelStage[] }) {
  const drop = biggestDrop(funnel)
  return (
    <section className="perf-section" aria-labelledby="perf-funnel-heading">
      <h3 id="perf-funnel-heading" className="perf-section-title">
        From Click to Customer
      </h3>
      <p className="perf-section-sub">Follow what happens after someone sees your advertisement.</p>
      <ol className="perf-funnel">
        {funnel.map((stage) => {
          const copy = STAGES[stage.key]
          return (
            <li key={stage.key} className="perf-funnel-stage">
              <div className="perf-card-head">
                <h4>{copy.label}</h4>
                <InfoTip metric={copy.metric} />
              </div>
              <p className="perf-value">{stage.count === null ? UNAVAILABLE : count(stage)}</p>
              {stage.count === null && <p className="perf-funnel-rate">Not reported</p>}
              {stage.count !== null && copy.of !== null && (
                <p className="perf-funnel-rate">
                  {stage.rateFromPrevious === null
                    ? 'No comparison available'
                    : `${formatPercent(stage.rateFromPrevious)} of ${copy.of}`}
                </p>
              )}
              <p className="perf-note">{METRIC_COPY[copy.metric].plain}</p>
            </li>
          )
        })}
      </ol>
      {drop && <p className="perf-funnel-drop">{drop}</p>}
    </section>
  )
}
