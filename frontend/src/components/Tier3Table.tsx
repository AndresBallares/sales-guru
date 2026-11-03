import type { DashboardAdRow, DashboardAdStatus, DashboardTier3 } from '../lib/api'
import { adAvatarLine, avatarMarker } from '../lib/avatarLabel'
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

// The buyer an ad was written for, with a marker when its avatar was deactivated or deleted.
function AvatarLine({ ad, className }: { ad: DashboardAdRow; className?: string }) {
  const line = adAvatarLine(ad)
  if (!line) return null
  const marker = avatarMarker(ad.avatarState)
  return (
    <span className={className}>
      {line}
      {marker && <span className="avatar-marker"> ({marker})</span>}
    </span>
  )
}

// "Compared over the last 4 days, while all ads ran" -> "compared over the last 4 days, ..."
function inSentence(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1)
}

function Row({ ad }: { ad: DashboardAdRow }) {
  return (
    <tr className={ad.isLeader ? 'dash-leader-row' : undefined}>
      <th scope="row">
        {ad.name}
        {ad.isLeader && <span className="dash-leader-tag">Leading</span>}
        <AvatarLine ad={ad} className="dash-ad-avatar" />
      </th>
      <td>
        <span className={`dash-status dash-status-${ad.status}`}>{STATUS_LABELS[ad.status]}</span>
      </td>
      <td>{formatMoney(ad.spend)}</td>
      <td>{formatPercent(ad.linkCtr)}</td>
      {ad.compared === false ? (
        <td colSpan={4}>Not compared: stopped before the other ads started</td>
      ) : (
        <>
          <td>{formatInteger(ad.addToCart)}</td>
          <td>{formatMoney(ad.costPerAddToCart)}</td>
          <td>{formatInteger(ad.purchases)}</td>
          <td>{formatMoney(ad.cac)}</td>
        </>
      )}
    </tr>
  )
}

// Tier 3 — the per-ad comparison a creative test exists to answer. A leader is
// named only when the data supports it (the backend's strict rule: every ad has
// 10+ purchases, or else every ad has 5+ add-to-carts, counted over the period all
// the ads ran together); otherwise it says so.
export function Tier3Table({ tier3 }: { tier3: DashboardTier3 }) {
  const leaderAd = tier3.leader ? tier3.ads.find((ad) => ad.adId === tier3.leader?.adId) : undefined
  return (
    <section className="dash-tier3" aria-labelledby="dash-tier3-heading">
      <h3 id="dash-tier3-heading" className="dash-section-heading">
        How each ad is doing
      </h3>
      <p className={tier3.leader ? 'dash-leader-line dash-leader-line-yes' : 'dash-leader-line'}>
        {tier3.leaderMessage}
      </p>
      {tier3.windowLabel && <p className="dash-window-label">{tier3.windowLabel}</p>}
      {leaderAd && adAvatarLine(leaderAd) && (
        <p className="dash-leader-avatar">
          {`Leading buyer: ${adAvatarLine(leaderAd)}`}
          {avatarMarker(leaderAd.avatarState) && (
            <span className="avatar-marker"> ({avatarMarker(leaderAd.avatarState)})</span>
          )}
          {tier3.windowLabel && ` (${inSentence(tier3.windowLabel)})`}
        </p>
      )}
      <p className="dash-note">
        An ad is only named the leader once every ad has enough results to compare fairly: at
        least 10 sales each, or else at least 5 add-to-carts each.
      </p>
      {tier3.windowLabel && (
        <p className="dash-note">
          Added to cart, cost per add to cart, sales and cost per sale count only the period all
          the ads ran together, so an ad that started earlier gets no head start. Spent so far and
          Clicked the ad cover each ad’s whole run.
        </p>
      )}
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
