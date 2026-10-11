import type { DashboardAdRow, DashboardAdStatus, DashboardTier3 } from '../lib/api'
import { formatInteger, formatMoney, formatPercent } from '../lib/dashboardFormat'

// Plain words for each ad's status.
const STATUS_LABELS: Record<DashboardAdStatus, string> = {
  live: 'Running',
  paused_by_optimizer: 'Paused by optimizer',
  proposed_pause: 'Pause suggested',
  paused: 'Paused',
}

// A column heading: the plain label, with the technical term in small text
// underneath (same pattern as the cards).
function Heading({ label, term }: { label: string; term?: string }) {
  return (
    <th scope="col">
      {label}
      {term && <span className="dash-term-inline dash-th-term">{term}</span>}
    </th>
  )
}

function Row({ ad }: { ad: DashboardAdRow }) {
  return (
    <tr className={ad.isLeader ? 'dash-leader-row' : undefined}>
      <th scope="row">
        {ad.name}
        {ad.isLeader && <span className="dash-leader-tag">Leading</span>}
      </th>
      <td>
        <span className={`dash-status dash-status-${ad.status}`}>{STATUS_LABELS[ad.status]}</span>
      </td>
      <td>{formatMoney(ad.spend)}</td>
      <td>{formatPercent(ad.linkCtr)}</td>
      <td>{formatInteger(ad.addToCart)}</td>
      <td>{formatMoney(ad.costPerAddToCart)}</td>
      <td>{formatInteger(ad.purchases)}</td>
      <td>{formatMoney(ad.cac)}</td>
    </tr>
  )
}

// Tier 3 — the per-ad comparison a creative test exists to answer. A leader is
// named only when the data supports it (the backend's strict rule: every ad has
// 10+ purchases, or else every ad has 5+ add-to-carts); otherwise it says so.
export function Tier3Table({ tier3 }: { tier3: DashboardTier3 }) {
  return (
    <section className="dash-tier3" aria-labelledby="dash-tier3-heading">
      <h3 id="dash-tier3-heading" className="dash-section-heading">
        How each ad is doing
      </h3>
      <p className={tier3.leader ? 'dash-leader-line dash-leader-line-yes' : 'dash-leader-line'}>
        {tier3.leaderMessage}
      </p>
      <p className="dash-note">
        An ad is only named the leader once every ad has enough results to compare fairly: at
        least 10 sales each, or else at least 5 add-to-carts each.
      </p>
      <div className="dash-table-wrap" role="region" aria-label="Ad comparison table" tabIndex={0}>
        <table className="dash-table">
          <caption className="visually-hidden">Results for each ad in this campaign</caption>
          <thead>
            <tr>
              <Heading label="Ad" />
              <Heading label="Status" />
              <Heading label="Spent so far" term="Ad spend" />
              <Heading label="Clicked the ad" term="Link CTR" />
              <Heading label="Added to cart" />
              <Heading label="Cost per add to cart" />
              <Heading label="Sales" term="Purchases" />
              <Heading label="Cost per sale" term="CAC" />
            </tr>
          </thead>
          <tbody>
            {tier3.ads.map((ad) => (
              <Row key={ad.adId} ad={ad} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
