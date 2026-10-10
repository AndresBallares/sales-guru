import { useEffect, useState } from 'react'
import {
  ApiError,
  getBusinessDashboard,
  getCampaignDashboard,
  getOptions,
  listCampaigns,
  toLabelMap,
  type BusinessDashboardSummary,
  type Campaign,
  type CampaignDashboard,
} from '../lib/api'
import { UNAVAILABLE, formatAsOf, formatInteger, formatMoney } from '../lib/dashboardFormat'
import { CardHeading } from './CardHeading'
import { ConfidenceFlag } from './ConfidenceFlag'
import { Tier1Cards } from './Tier1Cards'
import { Tier2Cards } from './Tier2Cards'

// Local development only: Vite sets import.meta.env.DEV false in a production
// build, so the sample switch never exists in what ships. (The backend also
// refuses sample requests unless DASHBOARD_SAMPLE_DATA is on, and refuses to
// boot with it on in production.)
const SAMPLE_SWITCH_AVAILABLE = import.meta.env.DEV

function campaignLabel(campaign: Pick<Campaign, 'name' | 'status'>): string {
  return `${campaign.name ?? 'Untitled campaign'} — ${campaign.status.toLowerCase()}`
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export function DashboardSection({ businessId }: { businessId: string }) {
  const [sample, setSample] = useState(false)
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [summary, setSummary] = useState<BusinessDashboardSummary | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dashboard, setDashboard] = useState<CampaignDashboard | null>(null)
  const [actionLabels, setActionLabels] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    getOptions()
      .then((options) => current && setActionLabels(toLabelMap(options.actionTypes)))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    let current = true
    Promise.all([listCampaigns(businessId), getBusinessDashboard(businessId, sample)])
      .then(([list, strip]) => {
        if (!current) return
        setCampaigns(list)
        setSummary(strip)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!current) return
        setCampaigns([])
        setSummary(null)
        setError(errorMessage(err, 'Could not load results.'))
      })
    return () => {
      current = false
    }
  }, [businessId, sample])

  // Real results only exist for a published campaign; the sample preview can
  // use any campaign (it never reads its stored numbers).
  const pickable = (campaigns ?? []).filter((c) => sample || c.metaCampaignId !== null)
  // The list is newest first, so the default is the latest published campaign.
  const defaultId = pickable[0]?.id ?? null
  const activeId =
    selectedId !== null && pickable.some((c) => c.id === selectedId) ? selectedId : defaultId

  useEffect(() => {
    if (activeId === null) return
    let current = true
    getCampaignDashboard(businessId, activeId, sample)
      .then((result) => {
        if (!current) return
        setDashboard(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!current) return
        setDashboard(null)
        setError(errorMessage(err, 'Could not load this campaign’s results.'))
      })
    return () => {
      current = false
    }
  }, [businessId, activeId, sample])

  const shown = dashboard !== null && dashboard.campaignId === activeId ? dashboard : null
  // Until Meta has reported anything, a total of $0.00 would read as a real zero.
  const hasStripData = (summary?.campaigns.length ?? 0) > 0

  return (
    <section className="dashboard-section" aria-labelledby="dashboard-heading">
      <div className="dashboard-heading-row">
        <h2 id="dashboard-heading">Results</h2>
        {SAMPLE_SWITCH_AVAILABLE && (
          <label className="dashboard-sample-switch">
            <input
              type="checkbox"
              checked={sample}
              onChange={(event) => setSample(event.target.checked)}
            />
            Preview with sample data
          </label>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {sample && summary?.isSample && (
        <output className="dash-sample-banner">
          Sample data — these are not your real numbers.
        </output>
      )}

      {campaigns === null && !error && <p>Loading results…</p>}

      {campaigns !== null && !error && pickable.length === 0 && (
        <p className="dash-empty">
          {sample
            ? 'Create a campaign to preview sample results.'
            : 'No published campaigns yet. Results appear here once you publish a campaign.'}
        </p>
      )}

      {summary && pickable.length > 0 && (
        <div className="dash-strip" aria-label="All campaigns">
          <article className="dash-card" aria-labelledby="strip-active">
            <CardHeading id="strip-active" label="Active campaigns" />
            <p className="dash-value">{formatInteger(summary.activeCampaigns)}</p>
            <p className="dash-note">Campaigns running right now.</p>
          </article>
          <article className="dash-card" aria-labelledby="strip-spend">
            <CardHeading id="strip-spend" label="Spent so far" term="Ad spend" />
            <p className="dash-value">
              {hasStripData ? formatMoney(summary.totalSpend) : UNAVAILABLE}
            </p>
            <p className="dash-note">What you’ve paid for ads across your campaigns.</p>
          </article>
          <article className="dash-card" aria-labelledby="strip-purchases">
            <CardHeading id="strip-purchases" label="Purchases" />
            <p className="dash-value">{formatInteger(summary.purchases)}</p>
            <p className="dash-note">Sales recorded across your published campaigns.</p>
          </article>
          <article className="dash-card" aria-labelledby="strip-cpp">
            <CardHeading
              id="strip-cpp"
              label="Cost per sale"
              term="Customer acquisition cost, CAC"
            />
            <p className="dash-value">{formatMoney(summary.costPerPurchase)}</p>
            <p className="dash-note">How much you paid in ads for each sale.</p>
            <ConfidenceFlag confidence={summary.confidence} />
          </article>
        </div>
      )}

      {pickable.length > 0 && activeId !== null && (
        <div className="dash-panel">
          <div className="field dash-picker">
            <label htmlFor="dashboard-campaign">Campaign</label>
            <select
              id="dashboard-campaign"
              value={activeId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {pickable.map((c) => (
                <option key={c.id} value={c.id}>
                  {campaignLabel(c)}
                </option>
              ))}
            </select>
          </div>

          {shown === null && !error && <p>Loading this campaign’s results…</p>}

          {shown && (
            <>
              {shown.pixelWarning && (
                <p className="dash-warning" role="alert">
                  <strong>Check your Pixel:</strong> {shown.pixelWarning}
                </p>
              )}

              {shown.proposals.length > 0 && (
                <section className="dash-proposals" aria-label="Pending optimizer proposals">
                  <h3>Waiting for your decision</h3>
                  <ul>
                    {shown.proposals.map((proposal) => (
                      <li key={proposal.id}>
                        <strong>
                          {actionLabels[proposal.actionType] ??
                            proposal.actionType.replaceAll('_', ' ').toLowerCase()}
                        </strong>
                        {proposal.targetAdName && <> — {proposal.targetAdName}</>}
                        <br />
                        {proposal.reasoning}
                      </li>
                    ))}
                  </ul>
                  <p className="dash-sub">Approve or reject these in the campaign list below.</p>
                </section>
              )}

              {shown.hasData && shown.tier1 ? (
                <>
                  {shown.status === 'PAUSED' && (
                    <p className="dash-paused" role="note">
                      <strong>Paused</strong>
                      {shown.pausedAt && <> on {formatAsOf(shown.pausedAt)}</>}
                      {shown.pausedReason && <> — {shown.pausedReason}</>}. These are its last
                      numbers; a paused campaign isn’t updated.
                    </p>
                  )}
                  <p className="dash-sub">
                    {shown.status === 'PAUSED' ? 'Last updated' : 'Updated'}{' '}
                    {formatAsOf(shown.asOf)}
                  </p>
                  {/* With fewer than 10 purchases the sales numbers can't be
                      judged, so how people are responding leads; once there are
                      enough purchases the verdict goes back on top. */}
                  {shown.tier2 && !shown.tier1.purchases.confidence.sufficient ? (
                    <>
                      <p className="dash-lead">
                        Too early to judge sales — here’s how people are responding to your
                        ads.
                      </p>
                      <Tier2Cards tier2={shown.tier2} />
                      <h3 className="dash-section-heading">Sales so far</h3>
                      <Tier1Cards tier1={shown.tier1} />
                    </>
                  ) : (
                    <>
                      <Tier1Cards tier1={shown.tier1} />
                      {shown.tier2 && <Tier2Cards tier2={shown.tier2} />}
                    </>
                  )}
                </>
              ) : shown.status === 'PAUSED' ? (
                <div className="dash-empty">
                  <p>
                    This campaign is paused and hasn’t run yet, so there are no results.
                    Results will appear here after it’s turned on.
                  </p>
                </div>
              ) : (
                <div className="dash-empty">
                  <p>
                    <strong>Published — no results yet.</strong>
                  </p>
                  <p>
                    Meta can take a few hours to report the first numbers after a campaign
                    starts, and this page checks every 15 minutes. Nothing is wrong:{' '}
                    {UNAVAILABLE} means “not reported yet”, not zero.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
