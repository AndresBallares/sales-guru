import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AudiencesSection } from '../components/AudiencesSection'
import { CampaignsSection } from '../components/CampaignsSection'
import { MetaConnectionSection } from '../components/MetaConnectionSection'
import { ProductsSection } from '../components/ProductsSection'
import { ApiError, getBusiness, type Business } from '../lib/api'

export function BusinessDetailPage() {
  const { businessId } = useParams<{ businessId: string }>()

  const [business, setBusiness] = useState<Business | null>(null)
  const [businessError, setBusinessError] = useState<string | null>(null)

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

  return (
    <main className="business-detail">
      <p>
        <Link to="/">&larr; Back to dashboard</Link>
      </p>
      <h1>{business ? business.name : 'Loading…'}</h1>
      {businessError && (
        <p className="form-error" role="alert">
          {businessError}
        </p>
      )}

      {businessId && (
        <>
          <ProductsSection businessId={businessId} />
          <AudiencesSection businessId={businessId} />
          <MetaConnectionSection businessId={businessId} />
          <CampaignsSection businessId={businessId} />
        </>
      )}
    </main>
  )
}
