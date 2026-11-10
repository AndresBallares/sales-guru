import { useCallback, useEffect, useState } from 'react'
import { getPerformance, type Performance, type PerformanceDays } from '../../lib/api'
import { formatInteger, formatMoney, formatPercent, formatRatio } from '../../lib/dashboardFormat'
import { CampaignTable } from './CampaignTable'
import { FunnelSection } from './FunnelSection'
import { Delta, MetricCard } from './MetricCard'
import { SyncStatus } from './SyncStatus'
import { TrendChart } from './TrendChart'
import { WhatThisMeans } from './WhatThisMeans'

const RANGES: { days: PerformanceDays; label: string }[] = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 0, label: 'All time' },
]

const REACH_NOTE =
  'Meta counts unique people per campaign, so this only shows for all time with one campaign.'

// The business's Advertising Performance: what the ads cost, what customers did,
// and where they dropped out. Everything is read from the numbers Sales Guru has
// already stored from Meta. Opening or refreshing the page only re-reads them: it
// never asks Meta for anything and never starts a sync.
export function PerformanceDashboard({
  businessId,
  onConnectMeta,
}: {
  businessId: string
  onConnectMeta?: () => void
}) {
  const [days, setDays] = useState<PerformanceDays>(7)
  const [data, setData] = useState<Performance | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let current = true
    getPerformance(businessId, days)
      .then((result) => {
        if (!current) return
        setData(result)
        setError(false)
      })
      .catch(() => current && setError(true))
      .finally(() => current && setBusy(false))
    return () => {
      current = false
    }
  }, [businessId, days, reload])

  const refresh = useCallback(() => {
    setBusy(true)
    setReload((n) => n + 1)
  }, [])

  const m = data?.current ?? null
  const p = data?.previous ?? null
  const span = days === 0 ? null : `previous ${days} days`

  return (
    <section className="perf" aria-labelledby="perf-heading" aria-busy={busy}>
      <header className="perf-header">
        <div className="perf-title-row">
          <span className="perf-brand" aria-hidden="true">
            <svg width="26" height="42" viewBox="0 0 320 512" fill="currentColor" focusable="false">
              <path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z" />
            </svg>
          </span>
          <div className="perf-title">
            <h2 id="perf-heading">Advertising Performance</h2>
            <p>
              Understand how your ads are performing, what customers are doing, and how much
              revenue your advertising generates.
            </p>
          </div>
        </div>
        <div className="perf-controls">
          <div className="perf-range">
            <label htmlFor="perf-range">Date range</label>
            <select
              id="perf-range"
              value={String(days)}
              onChange={(event) => {
                setBusy(true)
                setDays(Number(event.target.value) as PerformanceDays)
              }}
            >
              {RANGES.map((range) => (
                <option key={range.days} value={range.days}>
                  {range.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn-outline" onClick={refresh} disabled={busy}>
            {busy && data !== null ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {data && (
          <SyncStatus businessId={businessId} sync={data.sync} onConnectMeta={onConnectMeta} />
        )}
      </header>

      {error && (
        <p className="form-error" role="alert">
          Could not load advertising performance.
        </p>
      )}
      {data === null && !error && <p>Loading advertising performance…</p>}

      {data && m === null && (
        <p className="perf-empty">
          No results yet. Numbers appear here once Meta reports the first results for a published
          campaign; this page then updates about every {data.sync.intervalMinutes} minutes.
        </p>
      )}

      {data && m && (
        <>
          <section className="perf-overview" aria-label="Performance overview">
            <MetricCard
              metric="spend"
              primary
              value={formatMoney(m.spend)}
              delta={
                span && (
                  <Delta current={m.spend} previous={p?.spend} polarity="neutral" label={span} />
                )
              }
            />
            <MetricCard
              metric="purchases"
              primary
              value={formatInteger(m.purchases)}
              delta={
                span && (
                  <Delta
                    current={m.purchases}
                    previous={p?.purchases}
                    polarity="higher"
                    label={span}
                  />
                )
              }
            />
            <MetricCard
              metric="cac"
              primary
              value={formatMoney(m.costPerSale)}
              delta={
                span && (
                  <Delta
                    current={m.costPerSale}
                    previous={p?.costPerSale}
                    polarity="lower"
                    label={span}
                  />
                )
              }
            />
            <MetricCard
              metric="roas"
              primary
              value={formatRatio(m.roas)}
              delta={
                span && (
                  <Delta current={m.roas} previous={p?.roas} polarity="higher" label={span} />
                )
              }
            />
          </section>

          <section className="perf-section" aria-labelledby="perf-delivery-heading">
            <h3 id="perf-delivery-heading" className="perf-section-title">
              Your Advertising Performance
            </h3>
            <p className="perf-section-sub">See how people are responding to your advertisements.</p>
            <div className="perf-grid">
              <MetricCard metric="impressions" value={formatInteger(m.impressions)} />
              <MetricCard
                metric="reach"
                value={formatInteger(data.reach)}
                note={data.reach === null ? `${REACH_NOTE}` : undefined}
              />
              <MetricCard
                metric="frequency"
                value={data.frequency === null ? '—' : data.frequency.toFixed(2)}
                note={data.frequency === null ? `${REACH_NOTE}` : undefined}
              />
              <MetricCard metric="cpm" value={formatMoney(m.cpm)} />
            </div>
            <div className="perf-grid">
              <MetricCard metric="clicks" value={formatInteger(m.clicks)} />
              <MetricCard metric="linkClicks" value={formatInteger(m.linkClicks)} />
              <MetricCard metric="ctr" value={formatPercent(m.ctr)} />
              <MetricCard metric="cpc" value={formatMoney(m.cpc)} />
            </div>
          </section>

          <FunnelSection funnel={data.funnel} />

          <section className="perf-section" aria-labelledby="perf-costs-heading">
            <h3 id="perf-costs-heading" className="perf-section-title">
              What Your Advertising Is Costing You
            </h3>
            <div className="perf-grid">
              <MetricCard metric="costPerAddToCart" value={formatMoney(m.costPerAddToCart)} />
              <MetricCard metric="cac" value={formatMoney(m.costPerSale)} />
              <MetricCard
                metric="roas"
                title="ROAS"
                value={formatRatio(m.roas)}
                note={
                  m.roas === null
                    ? undefined
                    : `For every $1 spent on advertising, you generated $${m.roas.toFixed(2)} in attributed revenue.`
                }
              />
              <MetricCard metric="addToCartRate" value={formatPercent(m.addToCartRate)} />
            </div>
          </section>

          <WhatThisMeans />

          <TrendChart
            daily={data.daily}
            rangeLabel={days === 0 ? 'last 90 days' : `last ${days} days`}
          />

          <CampaignTable businessId={businessId} campaigns={data.campaigns} />
        </>
      )}
    </section>
  )
}
