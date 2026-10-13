import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AudiencesSection } from '../components/AudiencesSection'
import { BrandRequiredNotice } from '../components/BrandRequiredNotice'
import { CampaignsSection } from '../components/CampaignsSection'
import { DashboardSection } from '../components/DashboardSection'
import { MetaConnectionSection } from '../components/MetaConnectionSection'
import { MetaSettingsSection } from '../components/MetaSettingsSection'
import { ProductsSection } from '../components/ProductsSection'
import {
  ApiError,
  getBrandProfile,
  getBusiness,
  getMetaConnection,
  getOptions,
  listCampaigns,
  type Audience,
  type Business,
  type Campaign,
  type Option,
  type Product,
} from '../lib/api'

export function BusinessDetailPage() {
  const { businessId } = useParams<{ businessId: string }>()
  const [searchParams] = useSearchParams()
  // What the Meta OAuth round-trip came back with (?meta=...). Read once here:
  // the Meta setup step strips it from the URL as soon as it mounts.
  const [metaOutcome] = useState(() => searchParams.get('meta'))

  const [business, setBusiness] = useState<Business | null>(null)
  const [businessError, setBusinessError] = useState<string | null>(null)
  const [industries, setIndustries] = useState<Option[]>([])
  // null = not loaded yet; once loaded, a business that already has one
  // moves straight past that step. Campaign first (objective needs no
  // product/audience in view yet, and matches Meta Ads Manager's own
  // "objective first" flow, confirmed 2026-09-04) — Products/Audiences/
  // Meta fill in the rest, and whichever of a product/audience shows up
  // first gets auto-attached to it (app/services/campaign_readiness.py).
  // The Brand profile (PRD.md §5 step 3.5) now lives on the dashboard, under
  // Company Information, so it no longer gates this page.
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [products, setProducts] = useState<Product[] | null>(null)
  const [audiences, setAudiences] = useState<Audience[] | null>(null)
  const [metaSetupComplete, setMetaSetupComplete] = useState(false)
  // What decides which onboarding step this page opens on, loaded once up front:
  //  1. no brand profile  -> the hard gate (nothing here can start a campaign);
  //  2. no campaign yet and Meta not fully set up -> the Meta connection step,
  //     with "Continue to campaigns" once it is saved;
  //  3. otherwise the usual steps below.
  const [gate, setGate] = useState<
    | { state: 'loading' }
    | { state: 'error'; message: string }
    | { state: 'ready'; hasBrand: boolean; metaStep: boolean }
  >({ state: 'loading' })
  const [metaContinued, setMetaContinued] = useState(false)
  const [gateRevision, setGateRevision] = useState(0)
  // Bumped when the set of campaigns (or one's status) changes after the first load, so
  // the Results section reloads its picker instead of listing a deleted campaign.
  const [resultsRevision, setResultsRevision] = useState(0)
  const campaignsSignature = useRef<string | null>(null)
  const handleCampaignsChanged = useCallback((list: Campaign[]) => {
    const signature = list.map((c) => `${c.id}:${c.status}`).join('|')
    // The first report is the initial load, which Results has already fetched.
    if (campaignsSignature.current !== null && campaignsSignature.current !== signature) {
      setResultsRevision((revision) => revision + 1)
    }
    campaignsSignature.current = signature
  }, [])

  useEffect(() => {
    if (!businessId) {
      return
    }
    getBusiness(businessId)
      .then(setBusiness)
      .catch((err: unknown) => {
        setBusinessError(err instanceof ApiError ? err.message : 'Could not load business.')
      })
  }, [businessId])

  useEffect(() => {
    if (!businessId) {
      return
    }
    let current = true
    async function check(id: string) {
      try {
        const [hasBrand, connection, campaignList] = await Promise.all([
          getBrandProfile(id).then(
            () => true,
            (err: unknown) => {
              if (err instanceof ApiError && err.status === 404) return false
              throw err
            },
          ),
          getMetaConnection(id).then(
            (loaded) => loaded,
            (err: unknown) => {
              if (err instanceof ApiError && err.status === 404) return null
              throw err
            },
          ),
          listCampaigns(id),
        ])
        if (!current) return
        const metaComplete =
          connection !== null &&
          connection.adAccountId !== null &&
          connection.pageId !== null &&
          (connection.pixelId !== null || connection.pixelSkipped)
        setMetaSetupComplete(metaComplete)
        setGate({
          state: 'ready',
          hasBrand,
          metaStep: !metaComplete && campaignList.length === 0,
        })
      } catch (err) {
        if (!current) return
        setGate({
          state: 'error',
          message: err instanceof ApiError ? err.message : 'Could not check this business.',
        })
      }
    }
    void check(businessId)
    return () => {
      current = false
    }
  }, [businessId, gateRevision])

  useEffect(() => {
    getOptions()
      .then((options) => setIndustries(options.industries))
      .catch(() => setIndustries([]))
  }, [])

  return (
    <main className="business-detail">
      <p>
        <Link to="/">&larr; Back to dashboard</Link>
      </p>
      <h1>{business ? business.name : 'Loading…'}</h1>
      {business?.industry && (
        <p className="field-hint">
          {industries.find((option) => option.value === business.industry)?.label ??
            business.industry}
        </p>
      )}
      {businessError && (
        <p className="form-error" role="alert">
          {businessError}
        </p>
      )}

      {businessId && gate.state === 'loading' && <p>Loading…</p>}

      {businessId && gate.state === 'error' && (
        <section>
          <p className="form-error" role="alert">
            {gate.message}
          </p>
          <button
            type="button"
            className="btn-outline"
            onClick={() => {
              setGate({ state: 'loading' })
              setGateRevision((revision) => revision + 1)
            }}
          >
            Try again
          </button>
        </section>
      )}

      {businessId && gate.state === 'ready' && !gate.hasBrand && (
        <BrandRequiredNotice businessId={businessId} businessName={business?.name} />
      )}

      {businessId && gate.state === 'ready' && gate.hasBrand && gate.metaStep && !metaContinued && (
        <MetaConnectionSection
          businessId={businessId}
          onSetupComplete={setMetaSetupComplete}
          onContinue={() => setMetaContinued(true)}
        />
      )}

      {businessId &&
        gate.state === 'ready' &&
        gate.hasBrand &&
        (!gate.metaStep || metaContinued) && (
          <>
            {campaigns === null || campaigns.length === 0 ? (
              <CampaignsSection businessId={businessId} onCampaignsChange={setCampaigns} />
            ) : products === null || products.length === 0 ? (
              <ProductsSection businessId={businessId} onProductsChange={setProducts} />
            ) : audiences === null || audiences.length === 0 ? (
              <AudiencesSection businessId={businessId} onAudiencesChange={setAudiences} />
            ) : !metaSetupComplete ? (
              <MetaConnectionSection
                businessId={businessId}
                onSetupComplete={setMetaSetupComplete}
              />
            ) : (
              <>
                {/* Results first, then the campaign list: once onboarding is
                    done this page is where you check how the ads are doing. */}
                <DashboardSection businessId={businessId} refreshKey={resultsRevision} />
                <CampaignsSection
                  businessId={businessId}
                  onCampaignsChange={handleCampaignsChanged}
                />
                <MetaSettingsSection businessId={businessId} outcome={metaOutcome} />
              </>
            )}
          </>
        )}
    </main>
  )
}
