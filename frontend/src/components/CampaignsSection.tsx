import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  approveCampaign,
  createCampaign,
  createCreatives,
  createStrategy,
  getStrategy,
  listAudiences,
  listCampaigns,
  listCreatives,
  listProducts,
  publishCampaign,
  selectCreative,
  type Audience,
  type Campaign,
  type Creative,
  type Objective,
  type Product,
  type StrategyContent,
} from '../lib/api'

const OBJECTIVE_LABELS: Record<Objective, string> = {
  SALES: 'Ventas',
  LEADS: 'Leads',
  TRAFFIC: 'Tráfico',
  MESSAGES: 'Mensajes',
  AWARENESS: 'Reconocimiento',
}

const VARIANT_LETTERS = ['A', 'B', 'C', 'D']

export function CampaignsSection({ businessId }: { businessId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [objective, setObjective] = useState<Objective>('SALES')
  const [productId, setProductId] = useState('')
  const [audienceId, setAudienceId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [strategies, setStrategies] = useState<Record<string, StrategyContent>>({})
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [strategyErrors, setStrategyErrors] = useState<Record<string, string>>({})

  const [creatives, setCreatives] = useState<Record<string, Creative[]>>({})
  const [generatingCreativesId, setGeneratingCreativesId] = useState<string | null>(null)
  const [creativeErrors, setCreativeErrors] = useState<Record<string, string>>({})
  const [selectingId, setSelectingId] = useState<string | null>(null)

  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>({})

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

      // Strategies aren't included on the campaign list itself — fetch each
      // already-generated one so a page reload still shows it, not just a
      // freshly-clicked "Generate" result.
      const generated = campaignList.filter((c) => c.status !== 'DRAFT')
      const fetched = await Promise.all(
        generated.map((c) =>
          getStrategy(businessId, c.id)
            .then((strategy) => [c.id, strategy.content] as const)
            .catch(() => null),
        ),
      )
      setStrategies((prev) => {
        const next = { ...prev }
        for (const entry of fetched) {
          if (entry) next[entry[0]] = entry[1]
        }
        return next
      })

      // Same reasoning as strategies above — creatives aren't included on
      // the campaign list, so a page reload needs its own fetch to show a
      // previously generated batch.
      const fetchedCreatives = await Promise.all(
        generated.map((c) =>
          listCreatives(businessId, c.id)
            .then((list) => [c.id, list] as const)
            .catch(() => null),
        ),
      )
      setCreatives((prev) => {
        const next = { ...prev }
        for (const entry of fetchedCreatives) {
          if (entry && entry[1].length > 0) next[entry[0]] = entry[1]
        }
        return next
      })
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
        name: name || undefined,
        productId: productId || undefined,
        audienceId: audienceId || undefined,
      })
      setName('')
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

  async function handleGenerateStrategy(campaignId: string) {
    setGeneratingId(campaignId)
    setStrategyErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const strategy = await createStrategy(businessId, campaignId)
      setStrategies((prev) => ({ ...prev, [campaignId]: strategy.content }))
      await refresh()
    } catch (err) {
      setStrategyErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not generate strategy.',
      }))
    } finally {
      setGeneratingId(null)
    }
  }

  async function handleGenerateCreatives(campaignId: string) {
    setGeneratingCreativesId(campaignId)
    setCreativeErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const generated = await createCreatives(businessId, campaignId)
      setCreatives((prev) => ({ ...prev, [campaignId]: generated }))
    } catch (err) {
      setCreativeErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not generate ads.',
      }))
    } finally {
      setGeneratingCreativesId(null)
    }
  }

  async function handleSelectCreative(campaignId: string, creativeId: string) {
    setSelectingId(creativeId)
    try {
      const updated = await selectCreative(businessId, campaignId, creativeId)
      setCreatives((prev) => ({
        ...prev,
        [campaignId]: (prev[campaignId] ?? []).map((c) =>
          c.id === updated.id ? updated : { ...c, status: 'REJECTED' },
        ),
      }))
      // Selecting an ad advances campaign.status to PENDING_APPROVAL on the
      // backend — refresh so the Approve button appears without a reload.
      await refresh()
    } catch (err) {
      setCreativeErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not select ad.',
      }))
    } finally {
      setSelectingId(null)
    }
  }

  // A single explicit user action does both steps — approving never
  // silently triggers a publish on its own; this handler only runs from
  // one deliberate click (PRD.md §5 step 8's checkpoint requirement).
  // Skips the approve call when already APPROVED/FAILED, since retrying a
  // publish shouldn't need re-approving first.
  async function handleApproveAndPublish(campaignId: string, currentStatus: string) {
    setApprovingId(campaignId)
    setApproveErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      if (currentStatus === 'PENDING_APPROVAL') {
        await approveCampaign(businessId, campaignId)
      }
      await publishCampaign(businessId, campaignId)
      await refresh()
    } catch (err) {
      setApproveErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not publish campaign.',
      }))
    } finally {
      setApprovingId(null)
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
          {campaigns.map((campaign) => {
            const strategy = strategies[campaign.id]
            const strategyError = strategyErrors[campaign.id]
            const campaignCreatives = creatives[campaign.id] ?? []
            const creativeError = creativeErrors[campaign.id]
            const approveError = approveErrors[campaign.id]
            const canPublish = ['PENDING_APPROVAL', 'APPROVED', 'FAILED'].includes(
              campaign.status,
            )
            const isLive = campaign.status === 'LIVE'
            return (
              <li key={campaign.id}>
                {campaign.name ? `${campaign.name} — ` : ''}
                {OBJECTIVE_LABELS[campaign.objective]} — {campaign.status}
                <button
                  type="button"
                  onClick={() => handleGenerateStrategy(campaign.id)}
                  disabled={generatingId === campaign.id}
                >
                  {generatingId === campaign.id
                    ? 'Generating…'
                    : strategy
                      ? 'Regenerate strategy'
                      : 'Generate strategy'}
                </button>
                {strategyError && (
                  <p className="form-error" role="alert">
                    {strategyError}
                  </p>
                )}
                {strategy && (
                  <div aria-label={`Strategy for ${campaign.name ?? campaign.id}`}>
                    <p>
                      <strong>Offer:</strong> {strategy.offer}
                    </p>
                    <p>
                      <strong>Positioning:</strong> {strategy.positioning}
                    </p>
                    <p>
                      <strong>Target audience:</strong>{' '}
                      {[
                        strategy.targetAudience.ageMin != null &&
                        strategy.targetAudience.ageMax != null
                          ? `${strategy.targetAudience.ageMin}-${strategy.targetAudience.ageMax}`
                          : null,
                        strategy.targetAudience.location.join(', '),
                        strategy.targetAudience.interests.join(', '),
                      ]
                        .filter(Boolean)
                        .join(' — ')}
                    </p>
                    {strategy.targetAudience.problem && (
                      <p>
                        <strong>Problem:</strong> {strategy.targetAudience.problem}
                      </p>
                    )}
                    {strategy.targetAudience.desire && (
                      <p>
                        <strong>Desire:</strong> {strategy.targetAudience.desire}
                      </p>
                    )}
                    <p>
                      <strong>Creative angles:</strong>
                    </p>
                    <ul>
                      {strategy.creativeAngles.map((angle) => (
                        <li key={angle}>{angle}</li>
                      ))}
                    </ul>
                    <p>
                      <strong>Copy strategy:</strong> {strategy.copyStrategy}
                    </p>
                    <p>
                      <strong>Budget:</strong> ${strategy.budgetRecommendation.daily}/day —{' '}
                      {strategy.budgetRecommendation.rationale}
                    </p>
                  </div>
                )}
                {strategy && (
                  <div>
                    <button
                      type="button"
                      onClick={() => handleGenerateCreatives(campaign.id)}
                      disabled={generatingCreativesId === campaign.id}
                    >
                      {generatingCreativesId === campaign.id
                        ? 'Generating…'
                        : campaignCreatives.length > 0
                          ? 'Regenerate ads'
                          : 'Generate ads'}
                    </button>
                    {creativeError && (
                      <p className="form-error" role="alert">
                        {creativeError}
                      </p>
                    )}
                    {campaignCreatives.length > 0 && (
                      <ul aria-label={`Ad creatives for ${campaign.name ?? campaign.id}`}>
                        {campaignCreatives.map((c, index) => (
                          <li key={c.id}>
                            <p>
                              <strong>
                                Creative {VARIANT_LETTERS[index] ?? index + 1} —{' '}
                                {c.status}
                              </strong>
                            </p>
                            <p>
                              <strong>Headline:</strong> {c.headline}
                            </p>
                            <p>
                              <strong>Primary text:</strong> {c.bodyText}
                            </p>
                            <p>
                              <strong>Description:</strong> {c.description}
                            </p>
                            <p>
                              <strong>CTA:</strong> {c.cta}
                            </p>
                            {c.creativeAngle && (
                              <p>
                                <strong>Angle:</strong> {c.creativeAngle}
                              </p>
                            )}
                            {c.imagePrompt && (
                              <p>
                                <strong>Image prompt:</strong> {c.imagePrompt}
                              </p>
                            )}
                            {c.videoPrompt && (
                              <p>
                                <strong>Video prompt:</strong> {c.videoPrompt}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => handleSelectCreative(campaign.id, c.id)}
                              disabled={c.status === 'SELECTED' || selectingId === c.id}
                            >
                              {c.status === 'SELECTED'
                                ? 'Selected'
                                : selectingId === c.id
                                  ? 'Selecting…'
                                  : 'Select this ad'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {canPublish && (
                  <div>
                    <button
                      type="button"
                      onClick={() => handleApproveAndPublish(campaign.id, campaign.status)}
                      disabled={approvingId === campaign.id}
                    >
                      {approvingId === campaign.id
                        ? 'Publishing…'
                        : campaign.status === 'FAILED'
                          ? 'Retry publish'
                          : 'Approve & Publish'}
                    </button>
                    {approveError && (
                      <p className="form-error" role="alert">
                        {approveError}
                      </p>
                    )}
                  </div>
                )}
                {isLive && (
                  <p>
                    Live on Meta
                    {campaign.metaCampaignId ? ` (id: ${campaign.metaCampaignId})` : ''}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h2>Create a campaign</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="campaign-name">Name</label>
            <input
              id="campaign-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
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
