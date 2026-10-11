import type { DashboardFunnelStep, DashboardTier2 } from '../lib/api'
import {
  UNAVAILABLE,
  formatInteger,
  formatMoney,
  formatPercent,
} from '../lib/dashboardFormat'
import { CardHeading } from './CardHeading'
import { ConfidenceFlag } from './ConfidenceFlag'

// Plain words for each funnel step (the backend's labels are the technical ones).
const FUNNEL_LABELS: Record<DashboardFunnelStep['key'], { label: string; term: string }> = {
  impressions: { label: 'Saw the ad', term: 'Impressions' },
  link_clicks: { label: 'Clicked the ad', term: 'Link clicks' },
  add_to_cart: { label: 'Added to cart', term: 'Add to cart' },
  checkout: { label: 'Started checkout', term: 'Checkout initiated' },
  purchase: { label: 'Bought', term: 'Purchases' },
}

const LINK_CTR_CHIPS = {
  weak: { text: 'Low', good: false },
  below_typical: { text: 'Below typical', good: false },
  typical: { text: 'Typical', good: true },
  strong: { text: 'Strong', good: true },
} as const

const CPM_CHIPS = {
  needs_attention: { text: 'More than typical', good: false },
  within_acceptable_range: { text: 'Typical', good: true },
  strong: { text: 'Cheaper than typical', good: true },
  exceptional: { text: 'Much cheaper than typical', good: true },
} as const

function Funnel({ steps }: { steps: DashboardFunnelStep[] }) {
  return (
    <ol className="dash-funnel" aria-label="How people moved from seeing your ad to buying">
      {steps.map((step, index) => {
        const { label, term } = FUNNEL_LABELS[step.key]
        const kept = step.rateFromPrevious
        return (
          <li key={step.key} className="dash-funnel-step">
            <div className="dash-funnel-row">
              <span className="dash-funnel-label">
                {label} <span className="dash-term-inline">{term}</span>
              </span>
              <span className="dash-funnel-count">{formatInteger(step.count)}</span>
            </div>
            {index > 0 && (
              <p className="dash-funnel-drop">
                {kept !== null && step.dropOffFromPrevious !== null ? (
                  <>
                    {formatPercent(kept)} of the step before continued ·{' '}
                    {formatPercent(step.dropOffFromPrevious)} dropped off
                  </>
                ) : (
                  <>{UNAVAILABLE} not reported yet</>
                )}
              </p>
            )}
            {kept !== null && (
              <progress
                className="dash-bar"
                aria-label={`${label}: share of the step before that continued`}
                max={100}
                value={Math.max(1, Math.min(100, Math.round(kept)))}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// Tier 2 — early signals: is the funnel working before sales accumulate?
// Same pattern as Tier 1: plain label, technical term underneath, a one-line
// note on what it means, and the confidence flag on the card.
export function Tier2Cards({ tier2 }: { tier2: DashboardTier2 }) {
  const { linkCtr, cpm, addToCart, checkout, funnel } = tier2
  const ctrChip = linkCtr.band ? LINK_CTR_CHIPS[linkCtr.band] : null
  const cpmChip = cpm.zone ? CPM_CHIPS[cpm.zone] : null
  return (
    <section className="dash-tier2" aria-labelledby="dash-tier2-heading">
      <h3 id="dash-tier2-heading" className="dash-section-heading">
        How people are responding
      </h3>
      <Funnel steps={funnel} />
      <div className="dash-cards" aria-label="Early signals">
        <article className="dash-card" aria-labelledby="dash-ctr">
          <CardHeading
            id="dash-ctr"
            label="Clicked the ad"
            term="Link click-through rate, link CTR"
          />
          <p className="dash-value">{formatPercent(linkCtr.value)}</p>
          <p className="dash-sub">
            Typical for jewelry: {formatPercent(linkCtr.typicalLow)}–
            {formatPercent(linkCtr.typicalHigh)}. Under {formatPercent(linkCtr.weakBelow)}{' '}
            usually means the ad itself isn’t working.
          </p>
          {ctrChip && (
            <p className={`dash-chip ${ctrChip.good ? 'dash-chip-good' : 'dash-chip-bad'}`}>
              {ctrChip.text}
            </p>
          )}
          <p className="dash-note">
            {linkCtr.value !== null
              ? `About ${linkCtr.value.toFixed(1)} of every 100 people who saw your ad clicked through to your site.`
              : 'Of every 100 people who saw your ad, how many clicked through to your site.'}
          </p>
          <ConfidenceFlag confidence={linkCtr.confidence} />
        </article>

        <article className="dash-card" aria-labelledby="dash-cpm">
          <CardHeading
            id="dash-cpm"
            label="Cost to reach 1,000 people"
            term="CPM, cost per 1,000 impressions"
          />
          <p className="dash-value">{formatMoney(cpm.value)}</p>
          <p className="dash-sub">
            Typical for jewelry: {formatMoney(cpm.benchmarkLow)}–{formatMoney(cpm.benchmarkHigh)}
          </p>
          {cpmChip && (
            <p className={`dash-chip ${cpmChip.good ? 'dash-chip-good' : 'dash-chip-bad'}`}>
              {cpmChip.text}
            </p>
          )}
          <p className="dash-note">
            What it costs to show your ad 1,000 times; it mostly explains why your costs go up or
            down.
          </p>
          <ConfidenceFlag confidence={cpm.confidence} />
        </article>

        <article className="dash-card" aria-labelledby="dash-atc">
          <CardHeading id="dash-atc" label="Added to cart" term="Add-to-cart rate" />
          <p className="dash-value">{formatPercent(addToCart.rate)}</p>
          <p className="dash-sub">
            {formatInteger(addToCart.count)} added to cart
            {addToCart.costPer !== null && <> · {formatMoney(addToCart.costPer)} each</>}
            {addToCart.targetCostPer !== null && (
              <> (target {formatMoney(addToCart.targetCostPer)})</>
            )}
          </p>
          <p className="dash-note">
            Of the people who reached your site, how many added something to their cart.
          </p>
          <ConfidenceFlag confidence={addToCart.confidence} />
        </article>

        <article className="dash-card" aria-labelledby="dash-checkout">
          <CardHeading id="dash-checkout" label="Started checkout" term="Checkout rate" />
          <p className="dash-value">{formatPercent(checkout.rate)}</p>
          <p className="dash-sub">{formatInteger(checkout.count)} started checkout</p>
          <p className="dash-note">
            Of the people who added to cart, how many began to check out. A low number here often
            means shipping cost, trust or payment trouble.
          </p>
          <ConfidenceFlag confidence={checkout.confidence} />
        </article>
      </div>
    </section>
  )
}
