import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PerformanceCampaignRow } from '../../lib/api'
import { formatInteger, formatMoney, formatRatio } from '../../lib/dashboardFormat'

type SortKey =
  | 'name'
  | 'status'
  | 'spend'
  | 'impressions'
  | 'linkClicks'
  | 'addToCart'
  | 'purchases'
  | 'costPerSale'
  | 'revenue'
  | 'roas'

interface Column {
  key: SortKey
  label: string
  // Hidden on narrow screens so the table stays readable without scrolling sideways.
  secondary?: boolean
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Campaign' },
  { key: 'status', label: 'Status' },
  { key: 'spend', label: 'Spend' },
  { key: 'impressions', label: 'Impressions', secondary: true },
  { key: 'linkClicks', label: 'Link Clicks', secondary: true },
  { key: 'addToCart', label: 'Add to Cart', secondary: true },
  { key: 'purchases', label: 'Purchases' },
  { key: 'costPerSale', label: 'Cost Per Sale' },
  { key: 'revenue', label: 'Revenue', secondary: true },
  { key: 'roas', label: 'ROAS' },
]

const STATUS_LABELS: Record<string, string> = {
  LIVE: 'Live',
  PAUSED: 'Paused',
  ARCHIVED: 'Archived',
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  PENDING_APPROVAL: 'In review',
}

function statusLabel(status: string): string {
  return (
    STATUS_LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' ')
  )
}

function sortValue(row: PerformanceCampaignRow, key: SortKey): string | number | null {
  return key === 'name' ? (row.name ?? 'Untitled campaign').toLowerCase() : row[key]
}

// Campaign comparison for the selected period. Sorting puts campaigns with no
// figure last in either direction, and the name links to the campaign's own page.
export function CampaignTable({
  businessId,
  campaigns,
}: {
  businessId: string
  campaigns: PerformanceCampaignRow[]
}) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean } | null>(null)

  if (campaigns.length === 0) {
    return (
      <section className="perf-section" aria-labelledby="perf-campaigns-heading">
        <h3 id="perf-campaigns-heading" className="perf-section-title">
          Campaign Performance
        </h3>
        <p className="perf-empty">No campaigns have reported results yet.</p>
      </section>
    )
  }

  const rows = [...campaigns]
  if (sort) {
    rows.sort((a, b) => {
      const left = sortValue(a, sort.key)
      const right = sortValue(b, sort.key)
      if (left === null && right === null) return 0
      if (left === null) return 1
      if (right === null) return -1
      const order = left < right ? -1 : left > right ? 1 : 0
      return sort.descending ? -order : order
    })
  }

  function toggle(key: SortKey) {
    // Numbers start with the biggest; names and statuses start A to Z.
    const textual = key === 'name' || key === 'status'
    setSort((current) =>
      current?.key === key
        ? { key, descending: !current.descending }
        : { key, descending: !textual },
    )
  }

  return (
    <section className="perf-section" aria-labelledby="perf-campaigns-heading">
      <h3 id="perf-campaigns-heading" className="perf-section-title">
        Campaign Performance
      </h3>
      <p className="perf-section-sub">Compare your campaigns over the selected period.</p>
      <div className="perf-table-wrap">
        <table className="perf-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.secondary ? 'perf-col-secondary' : undefined}
                  aria-sort={
                    sort?.key === column.key
                      ? sort.descending
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="perf-sort"
                    data-direction={
                      sort?.key === column.key ? (sort.descending ? 'desc' : 'asc') : undefined
                    }
                    onClick={() => toggle(column.key)}
                  >
                    {column.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.campaignId}>
                <td>
                  <Link to={`/businesses/${businessId}/campaigns/${row.campaignId}/ad`}>
                    {row.name ?? 'Untitled campaign'}
                  </Link>
                </td>
                <td>
                  <span className={`perf-badge perf-badge-${row.status.toLowerCase()}`}>
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td>{formatMoney(row.spend)}</td>
                <td className="perf-col-secondary">{formatInteger(row.impressions)}</td>
                <td className="perf-col-secondary">{formatInteger(row.linkClicks)}</td>
                <td className="perf-col-secondary">{formatInteger(row.addToCart)}</td>
                <td>{formatInteger(row.purchases)}</td>
                <td>{formatMoney(row.costPerSale)}</td>
                <td className="perf-col-secondary">{formatMoney(row.revenue)}</td>
                <td>{formatRatio(row.roas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
