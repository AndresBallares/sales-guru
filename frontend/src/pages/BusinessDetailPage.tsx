import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AudiencesSection } from '../components/AudiencesSection'
import { BrandProfileSection } from '../components/BrandProfileSection'
import { BusinessEditForm } from '../components/BusinessEditForm'
import { CampaignsSection } from '../components/CampaignsSection'
import { MetaConnectionSection } from '../components/MetaConnectionSection'
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
  const [editingBusiness, setEditingBusiness] = useState(false)

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
      {business && editingBusiness ? (
        <BusinessEditForm
          businessId={business.id}
          business={business}
          onSaved={(updated) => {
            setBusiness(updated)
            setEditingBusiness(false)
          }}
          onCancel={() => setEditingBusiness(false)}
        />
      ) : (
        <>
          <h1>{business ? business.name : 'Loading…'}</h1>
          {business?.industry && (
            <p className="field-hint">
              {industries.find((option) => option.value === business.industry)?.label ??
                business.industry}
            </p>
          )}
          {business && (
            <button type="button" onClick={() => setEditingBusiness(true)}>
              Edit
            </button>
          )}
        </>
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
            <CampaignsSection businessId={businessId} />
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
