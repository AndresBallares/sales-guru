import type { DashboardTier1 } from '../lib/api'
import { formatInteger, formatMoney, formatPercent } from '../lib/dashboardFormat'
import { CardHeading } from './CardHeading'
import { ConfidenceFlag } from './ConfidenceFlag'

// Tier 1 — the verdict: "did this make money, and if not yet, is it on track?"
// Labels are plain words with the technical term underneath, and each card
// says in one line what the number means. Raw counts sit beside the ratios
// (3 sales and $420, not just a return), each ratio is shown next to the
// number it is judged against, and every card that rests on purchases carries
// its confidence flag on the card itself.
export function Tier1Cards({ tier1 }: { tier1: DashboardTier1 }) {
  const { spend, purchases, revenue, costPerPurchase, roas } = tier1
  const percentOfPlan = spend.percentOfPlan
  return (
    <div className="dash-cards" aria-label="Campaign results">
      <article className="dash-card" aria-labelledby="dash-spend">
        <CardHeading id="dash-spend" label="Spent so far" term="Ad spend" />
        <p className="dash-value">{formatMoney(spend.value)}</p>
        {spend.plannedTotal !== null ? (
          <>
            <p className="dash-sub">
              of {formatMoney(spend.plannedTotal)} budget
              {percentOfPlan !== null && <> ({formatPercent(percentOfPlan, 0)})</>}
            </p>
            {percentOfPlan !== null && (
              <progress
                className="dash-bar"
                aria-label="Share of the budget spent"
                max={100}
                value={Math.min(100, Math.round(percentOfPlan))}
              />
            )}
          </>
        ) : spend.plannedDaily !== null ? (
          <p className="dash-sub">Budget: {formatMoney(spend.plannedDaily)} a day</p>
        ) : (
          <p className="dash-sub">No budget on record</p>
        )}
        <p className="dash-note">What you’ve paid for these ads so far, compared with your budget.</p>
      </article>

      <article className="dash-card" aria-labelledby="dash-purchases">
        <CardHeading id="dash-purchases" label="Purchases" />
        <p className="dash-value">{formatInteger(purchases.value)}</p>
        <p className="dash-note">Sales your website recorded from these ads (counted by your Pixel).</p>
        <ConfidenceFlag confidence={purchases.confidence} />
      </article>

      <article className="dash-card" aria-labelledby="dash-revenue">
        <CardHeading id="dash-revenue" label="Revenue" />
        <p className="dash-value">{formatMoney(revenue.value)}</p>
        <p className="dash-note">The money you made from those sales.</p>
        <ConfidenceFlag confidence={revenue.confidence} />
      </article>

      <article className="dash-card" aria-labelledby="dash-cac">
        <CardHeading
          id="dash-cac"
          label="Cost per sale"
          term="Customer acquisition cost, CAC"
        />
        <p className="dash-value">{formatMoney(costPerPurchase.value)}</p>
        <p className="dash-sub">
          Target {formatMoney(costPerPurchase.target)} (
          {costPerPurchase.targetSource === 'unit_economics'
            ? 'from your price and margin'
            : 'industry benchmark'}
          )
        </p>
        {costPerPurchase.position === 'below_target' && (
          <p className="dash-chip dash-chip-good">Below target</p>
        )}
        {costPerPurchase.position === 'above_target' && (
          <p className="dash-chip dash-chip-bad">Above target</p>
        )}
        {costPerPurchase.value === null && <p className="dash-sub">No sales yet</p>}
        <p className="dash-note">How much you paid in ads for each sale.</p>
        <ConfidenceFlag confidence={costPerPurchase.confidence} />
      </article>

      <article className="dash-card" aria-labelledby="dash-roas">
        <CardHeading
          id="dash-roas"
          label="Revenue per $1 spent"
          term="Return on ad spend, ROAS"
        />
        <p className="dash-value">{formatMoney(roas.value)}</p>
        {roas.breakeven !== null ? (
          <p className="dash-sub">Break-even point: {formatMoney(roas.breakeven)}</p>
        ) : (
          <p className="dash-sub">
            Add a price and margin to this product to see your break-even point.
          </p>
        )}
        {roas.position === 'above_breakeven' && (
          <p className="dash-chip dash-chip-good">Above break-even</p>
        )}
        {roas.position === 'below_breakeven' && (
          <p className="dash-chip dash-chip-bad">Below break-even</p>
        )}
        {roas.value === null && <p className="dash-sub">Not available until sales are recorded</p>}
        <p className="dash-note">
          {roas.breakeven !== null
            ? `You need at least ${formatMoney(roas.breakeven)} back per $1 spent to make a profit.`
            : 'Dollars of sales for every $1 you spend on ads.'}
        </p>
        <ConfidenceFlag confidence={roas.confidence} />
      </article>
    </div>
  )
}
