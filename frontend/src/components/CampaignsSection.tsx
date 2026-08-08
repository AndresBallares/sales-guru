import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  createCampaign,
  listAudiences,
  listCampaigns,
  listProducts,
  type Audience,
  type Campaign,
  type Objective,
  type Product,
} from '../lib/api'

const OBJECTIVE_LABELS: Record<Objective, string> = {
  SALES: 'Ventas',
  LEADS: 'Leads',
  TRAFFIC: 'Tráfico',
  MESSAGES: 'Mensajes',
  AWARENESS: 'Reconocimiento',
}

export function CampaignsSection({ businessId }: { businessId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [objective, setObjective] = useState<Objective>('SALES')
  const [productId, setProductId] = useState('')
  const [audienceId, setAudienceId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [campaignList, productList, audienceList] = await Promise.all([
        listCampaigns(businessId),
        listProducts(businessId),
        listAudiences(businessId),
      ])
      setCampaigns(campaignList)
      setProducts(productList)
      setAudiences(audienceList)
      setListError(null)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load campaigns.')
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Products/audiences are also editable in sibling sections on this same
  // page — refetch on focus so a product/audience added a moment ago shows
  // up here without requiring a full page reload.
  const refreshOptions = useCallback(() => {
    listProducts(businessId).then(setProducts).catch(() => undefined)
    listAudiences(businessId).then(setAudiences).catch(() => undefined)
  }, [businessId])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      await createCampaign(businessId, {
        objective,
        productId: productId || undefined,
        audienceId: audienceId || undefined,
      })
      setObjective('SALES')
      setProductId('')
      setAudienceId('')
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create campaign.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section>
        <h2>Campaigns</h2>
        {loading && <p>Loading…</p>}
        {listError && (
          <p className="form-error" role="alert">
            {listError}
          </p>
        )}
        {!loading && !listError && campaigns.length === 0 && (
          <p>No campaigns yet — create your first one below.</p>
        )}
        <ul>
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              {OBJECTIVE_LABELS[campaign.objective]} — {campaign.status}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Create a campaign</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="objective">Objective</label>
            <select
              id="objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value as Objective)}
            >
              {Object.entries(OBJECTIVE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="product">Product</label>
            <select
              id="product"
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              onFocus={refreshOptions}
            >
              <option value="">None</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.description}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="audience">Audience</label>
            <select
              id="audience"
              value={audienceId}
              onChange={(event) => setAudienceId(event.target.value)}
              onFocus={refreshOptions}
            >
              <option value="">None</option>
              {audiences.map((audience) => (
                <option key={audience.id} value={audience.id}>
                  {audience.description}
                </option>
              ))}
            </select>
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create campaign'}
          </button>
        </form>
      </section>
    </>
  )
}
