import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AudiencesSection } from '../components/AudiencesSection'
import { BrandProfileSection } from '../components/BrandProfileSection'
import { CampaignsSection } from '../components/CampaignsSection'
import { DashboardSection } from '../components/DashboardSection'
import { MetaConnectionSection } from '../components/MetaConnectionSection'
import { MetaSettingsSection } from '../components/MetaSettingsSection'
import { ProductsSection } from '../components/ProductsSection'
import {
  ApiError,
  getBusiness,
  getOptions,
  type Audience,
  type BrandProfile,
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
  // moves straight past that step — same reasoning for all five. Brand
  // comes first, right after Company Information (PRD.md §5 step 3.5,
  // confirmed 2026-09-11 — "brand DNA" the Strategist/Creative Agents
  // ground into once filled in) — then Campaign (objective needs no
  // product/audience in view yet, and matches Meta Ads Manager's own
  // "objective first" flow, confirmed 2026-09-04) — Products/Audiences/
  // Meta fill in the rest, and whichever of a product/audience shows up
  // first gets auto-attached to it (app/services/campaign_readiness.py).
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [products, setProducts] = useState<Product[] | null>(null)
  const [audiences, setAudiences] = useState<Audience[] | null>(null)
  const [metaSetupComplete, setMetaSetupComplete] = useState(false)
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

      {businessId && brandProfile === null && (
        <BrandProfileSection businessId={businessId} onProfileChange={setBrandProfile} />
      )}

      {businessId && brandProfile !== null && (
        <>
          {campaigns === null || campaigns.length === 0 ? (
            <CampaignsSection businessId={businessId} onCampaignsChange={setCampaigns} />
          ) : products === null || products.length === 0 ? (
            <ProductsSection businessId={businessId} onProductsChange={setProducts} />
          ) : audiences === null || audiences.length === 0 ? (
            <AudiencesSection businessId={businessId} onAudiencesChange={setAudiences} />
          ) : !metaSetupComplete ? (
            <MetaConnectionSection businessId={businessId} onSetupComplete={setMetaSetupComplete} />
          ) : (
            <>
              {/* Results first, then the campaign list: once onboarding is
                  done this page is where you check how the ads are doing. */}
              <DashboardSection businessId={businessId} refreshKey={resultsRevision} />
              <CampaignsSection businessId={businessId} onCampaignsChange={handleCampaignsChanged} />
              <MetaSettingsSection businessId={businessId} outcome={metaOutcome} />
            </>
          )}
          {/* Reachable from every step once a profile exists, not just
              once onboarding is fully complete — "editable later from
              the business page" (PRD.md §5 step 3.5), not a one-time-only
              onboarding gate. */}
          <BrandProfileSection businessId={businessId} onProfileChange={setBrandProfile} />
        </>
      )}
    </main>
  )
}
