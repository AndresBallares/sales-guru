import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ApiError,
  approveCampaign,
  approveRecommendation,
  createCampaign,
  createCreatives,
  createRecommendation,
  createStrategy,
  createTestEvaluation,
  getBusiness,
  getOptions,
  getStrategy,
  listAudiences,
  listCampaigns,
  listCreatives,
  listMetrics,
  listProductImages,
  listProducts,
  listRecommendations,
  listTestEvaluations,
  pauseCampaign,
  publishCampaign,
  refreshMetrics,
  rejectRecommendation,
  selectCreative,
  toLabelMap,
  updateCampaign,
  uploadProductImage,
  type Audience,
  type Business,
  type Campaign,
  type Creative,
  type Metric,
  type Objective,
  type OptionsResponse,
  type Product,
  type ProductImage,
  type Recommendation,
  type StrategyContent,
  type TargetLocation,
  type TestEvaluation,
} from '../lib/api'
import { requiresDestinationUrl } from '../lib/urlValidation'
import { AudienceForm } from './AudienceForm'
import { NewCampaignFlow } from './NewCampaignFlow'
import { ProductForm } from './ProductForm'

function formatLocations(locations: TargetLocation[]): string {
  return locations
    .map((loc) => [loc.city, loc.region].filter(Boolean).join(', '))
    .join('; ')
}

const VARIANT_LETTERS = ['A', 'B', 'C', 'D']

export function CampaignsSection({
  businessId,
  onCampaignsChange,
}: {
  businessId: string
  onCampaignsChange?: (campaigns: Campaign[]) => void
}) {
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  // Only fetched for the "add a business description" nudge on the
  // create-campaign step below — nothing else here needs the business.
  const [business, setBusiness] = useState<Business | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  // Fetched once on mount, not as part of refresh() below — every fixed
  // option list here (objectives, campaign statuses, ad CTAs, optimizer
  // action types, event venues) is static, so there's no reason to
  // re-fetch it after every campaign mutation the way campaigns/products/
  // audiences need to be.
  const [options, setOptions] = useState<OptionsResponse | null>(null)

  // The manual fallback for the readiness checklist below — reuses
  // handleAttachToCampaign above for the actual swap.
  const [pickProductId, setPickProductId] = useState<Record<string, string>>({})
  const [pickAudienceId, setPickAudienceId] = useState<Record<string, string>>({})
  const [attachingId, setAttachingId] = useState<string | null>(null)
  const [attachErrors, setAttachErrors] = useState<Record<string, string>>({})

  // "Change product" is always visible (Part 2), not just while a
  // campaign is DRAFT and missing one. Only one campaign's picker is
  // open at a time. Defaults to the full create form (matching
  // NewCampaignFlow's guided flow, confirmed 2026-09-09 — a second+
  // product is almost always a fresh one, not a reused one); reuse is
  // the secondary path via reuseProductForCampaignId.
  const [productPickerId, setProductPickerId] = useState<string | null>(null)
  const [reuseProductForCampaignId, setReuseProductForCampaignId] = useState<string | null>(
    null,
  )
  const [editingProductForCampaignId, setEditingProductForCampaignId] = useState<string | null>(
    null,
  )

  // Mirrors productPickerId/reuseProductForCampaignId above, for the
  // audience picker in the readiness checklist below — collapsed by
  // default (one "Attach an audience" click opens it for one campaign
  // at a time) so it doesn't compete for the same field labels as
  // NewCampaignFlow's own audience step when both are open together.
  const [audiencePickerId, setAudiencePickerId] = useState<string | null>(null)
  const [reuseAudienceForCampaignId, setReuseAudienceForCampaignId] = useState<string | null>(
    null,
  )

  const [name, setName] = useState('')
  const [objective, setObjective] = useState<Objective>('SALES')
  const [eventVenueKey, setEventVenueKey] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Manually toggled via the "New campaign" button/Cancel below. A
  // business with zero campaigns shows the form regardless (the
  // formVisible check below), so this only matters once there's at least
  // one campaign already in the list.
  const [showCreateForm, setShowCreateForm] = useState(false)

  const [strategies, setStrategies] = useState<Record<string, StrategyContent>>({})
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [strategyErrors, setStrategyErrors] = useState<Record<string, string>>({})
  // Set when the backend responds 428 — it needs the one-time "has this
  // business advertised before?" answer before it can generate a strategy.
  const [needsAdExperienceAnswerId, setNeedsAdExperienceAnswerId] = useState<
    string | null
  >(null)

  const [creatives, setCreatives] = useState<Record<string, Creative[]>>({})
  const [generatingCreativesId, setGeneratingCreativesId] = useState<string | null>(null)
  const [creativeErrors, setCreativeErrors] = useState<Record<string, string>>({})
  const [selectingId, setSelectingId] = useState<string | null>(null)
  // Once a creative is selected, its campaign collapses to that one ad
  // (the ad-set preview) instead of the full 4-variant list — keyed by
  // campaign id, this reopens the list so the user can pick a different
  // one without regenerating (which would discard the other three).
  const [showAllCreatives, setShowAllCreatives] = useState<Record<string, boolean>>({})

  // Image controls below the selected ad — keyed by creative id, since
  // that's the specific ad the chosen photo attaches to.
  const [imageMenuId, setImageMenuId] = useState<string | null>(null)
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [loadingLibraryId, setLoadingLibraryId] = useState<string | null>(null)
  // Keyed by product id, not creative id — the same product's library is
  // shared across every creative (and campaign) that sells it.
  const [productImages, setProductImages] = useState<Record<string, ProductImage[]>>({})
  const [uploadingImageId, setUploadingImageId] = useState<string | null>(null)
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({})

  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>({})
  const [pausingId, setPausingId] = useState<string | null>(null)
  const [pauseErrors, setPauseErrors] = useState<Record<string, string>>({})

  const [metrics, setMetrics] = useState<Record<string, Metric[]>>({})
  const [refreshingMetricsId, setRefreshingMetricsId] = useState<string | null>(null)
  const [metricErrors, setMetricErrors] = useState<Record<string, string>>({})

  const [recommendations, setRecommendations] = useState<Record<string, Recommendation[]>>({})
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [analyzeErrors, setAnalyzeErrors] = useState<Record<string, string>>({})
  const [actingRecommendation, setActingRecommendation] = useState<{
    id: string
    action: 'approve' | 'reject'
  } | null>(null)
  const [recommendationErrors, setRecommendationErrors] = useState<Record<string, string>>({})

  const [testEvaluations, setTestEvaluations] = useState<Record<string, TestEvaluation[]>>({})
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null)
  const [evaluateErrors, setEvaluateErrors] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [campaignList, productList, audienceList] = await Promise.all([
        listCampaigns(businessId),
        listProducts(businessId),
        listAudiences(businessId),
      ])
      setCampaigns(campaignList)
      onCampaignsChange?.(campaignList)
      setProducts(productList)
      setAudiences(audienceList)
      setListError(null)

      // Best-effort, separate from the Promise.all above — this only
      // powers the "add a business description" nudge below, so a
      // failure here (e.g. the business itself failed to load elsewhere
      // on the page) shouldn't take down the whole campaigns list.
      getBusiness(businessId)
        .then(setBusiness)
        .catch(() => setBusiness(null))

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

      // Same reasoning again — only LIVE campaigns can have results, and
      // the campaign list itself doesn't include them.
      const live = campaignList.filter((c) => c.status === 'LIVE')
      const fetchedMetrics = await Promise.all(
        live.map((c) =>
          listMetrics(businessId, c.id)
            .then((list) => [c.id, list] as const)
            .catch(() => null),
        ),
      )
      setMetrics((prev) => {
        const next = { ...prev }
        for (const entry of fetchedMetrics) {
          if (entry && entry[1].length > 0) next[entry[0]] = entry[1]
        }
        return next
      })

      // Same reasoning again — only LIVE campaigns can have recommendations,
      // and the campaign list itself doesn't include them.
      const fetchedRecommendations = await Promise.all(
        live.map((c) =>
          listRecommendations(businessId, c.id)
            .then((list) => [c.id, list] as const)
            .catch(() => null),
        ),
      )
      setRecommendations((prev) => {
        const next = { ...prev }
        for (const entry of fetchedRecommendations) {
          if (entry && entry[1].length > 0) next[entry[0]] = entry[1]
        }
        return next
      })

      // Same reasoning again — only LIVE campaigns can have test
      // evaluations, and the campaign list itself doesn't include them.
      const fetchedTestEvaluations = await Promise.all(
        live.map((c) =>
          listTestEvaluations(businessId, c.id)
            .then((list) => [c.id, list] as const)
            .catch(() => null),
        ),
      )
      setTestEvaluations((prev) => {
        const next = { ...prev }
        for (const entry of fetchedTestEvaluations) {
          if (entry && entry[1].length > 0) next[entry[0]] = entry[1]
        }
        return next
      })
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load campaigns.')
    } finally {
      setLoading(false)
    }
  }, [businessId, onCampaignsChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    getOptions()
      .then(setOptions)
      .catch(() => setOptions(null))
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      // No product/audience picked here — objective comes first in this
      // flow, before either necessarily exists (PRD.md ...). Whichever
      // shows up first gets auto-attached (app/services/
      // campaign_readiness.py), or picked manually below once there's
      // more than one to choose from.
      await createCampaign(businessId, {
        objective,
        name: name || undefined,
        eventVenueKey: eventVenueKey || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      })
      setName('')
      setObjective('SALES')
      setEventVenueKey('')
      setStartDate('')
      setEndDate('')
      setShowCreateForm(false)
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create campaign.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleCancelCreate() {
    setName('')
    setObjective('SALES')
    setEventVenueKey('')
    setStartDate('')
    setEndDate('')
    setFormError(null)
    setShowCreateForm(false)
  }

  async function handleAttachToCampaign(
    campaignId: string,
    fields: { productId?: string; audienceId?: string },
  ) {
    setAttachingId(campaignId)
    setAttachErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const updated = await updateCampaign(businessId, campaignId, fields)
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (err) {
      setAttachErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not update campaign.',
      }))
    } finally {
      setAttachingId(null)
    }
  }

  async function handleGenerateStrategy(campaignId: string, hasPriorAdvertisingExperience?: boolean) {
    setGeneratingId(campaignId)
    setStrategyErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const strategy = await createStrategy(businessId, campaignId, hasPriorAdvertisingExperience)
      setStrategies((prev) => ({ ...prev, [campaignId]: strategy.content }))
      setNeedsAdExperienceAnswerId(null)
      await refresh()
    } catch (err) {
      if (err instanceof ApiError && err.status === 428) {
        // The one-time question hasn't been answered for this business yet
        // — ask, then retry with the answer (handleAnswerAdExperience).
        setNeedsAdExperienceAnswerId(campaignId)
        return
      }
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
      setShowAllCreatives((prev) => ({ ...prev, [campaignId]: false }))
      // Selecting an ad advances campaign.status to PENDING_APPROVAL on the
      // backend — refresh so the Approve button appears without a reload.
      await refresh()
      // The dedicated ad page owns the preview/image-upload/Approve &
      // Publish flow from here — see AdPreviewPage.
      navigate(`/businesses/${businessId}/campaigns/${campaignId}/ad`)
    } catch (err) {
      setCreativeErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not select ad.',
      }))
    } finally {
      setSelectingId(null)
    }
  }

  function handleToggleImageMenu(creativeId: string) {
    setImageMenuId((prev) => (prev === creativeId ? null : creativeId))
    setLibraryId(null)
  }

  async function handleAttachImageToCreative(
    campaignId: string,
    creativeId: string,
    productImageId: string,
  ) {
    setImageErrors((prev) => ({ ...prev, [creativeId]: '' }))
    try {
      const updated = await selectCreative(businessId, campaignId, creativeId, productImageId)
      setCreatives((prev) => ({
        ...prev,
        [campaignId]: (prev[campaignId] ?? []).map((c) => (c.id === updated.id ? updated : c)),
      }))
      setImageMenuId(null)
      setLibraryId(null)
    } catch (err) {
      setImageErrors((prev) => ({
        ...prev,
        [creativeId]: err instanceof ApiError ? err.message : 'Could not attach image.',
      }))
    }
  }

  async function handleUploadCreativeImage(
    campaignId: string,
    creativeId: string,
    productId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadingImageId(creativeId)
    setImageErrors((prev) => ({ ...prev, [creativeId]: '' }))
    try {
      const image = await uploadProductImage(businessId, productId, file)
      setProductImages((prev) => ({
        ...prev,
        [productId]: [...(prev[productId] ?? []), image],
      }))
      await handleAttachImageToCreative(campaignId, creativeId, image.id)
    } catch (err) {
      setImageErrors((prev) => ({
        ...prev,
        [creativeId]: err instanceof ApiError ? err.message : 'Could not upload image.',
      }))
    } finally {
      setUploadingImageId(null)
    }
  }

  async function handleOpenLibrary(creativeId: string, productId: string) {
    setLibraryId(creativeId)
    setLoadingLibraryId(creativeId)
    setImageErrors((prev) => ({ ...prev, [creativeId]: '' }))
    try {
      const images = await listProductImages(businessId, productId)
      setProductImages((prev) => ({ ...prev, [productId]: images }))
    } catch (err) {
      setImageErrors((prev) => ({
        ...prev,
        [creativeId]: err instanceof ApiError ? err.message : 'Could not load photo library.',
      }))
    } finally {
      setLoadingLibraryId(null)
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

  // The one-click "stop spending" action — pauses every AdSet in the
  // campaign, not just one Ad (distinct from an Optimizer PAUSE_AD
  // recommendation, which only ever pauses one). No confirmation dialog
  // here on purpose: this is itself the explicit, deliberate action, and
  // it's always reversible on Meta's side (a paused AdSet can be
  // resumed there) even though this app doesn't yet offer a resume button.
  async function handlePause(campaignId: string) {
    setPausingId(campaignId)
    setPauseErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      await pauseCampaign(businessId, campaignId)
      await refresh()
    } catch (err) {
      setPauseErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not pause campaign.',
      }))
    } finally {
      setPausingId(null)
    }
  }

  async function handleRefreshMetrics(campaignId: string) {
    setRefreshingMetricsId(campaignId)
    setMetricErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const metric = await refreshMetrics(businessId, campaignId)
      setMetrics((prev) => ({ ...prev, [campaignId]: [metric, ...(prev[campaignId] ?? [])] }))
    } catch (err) {
      setMetricErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not refresh results.',
      }))
    } finally {
      setRefreshingMetricsId(null)
    }
  }

  async function handleEvaluateTestPlan(campaignId: string) {
    setEvaluatingId(campaignId)
    setEvaluateErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const evaluation = await createTestEvaluation(businessId, campaignId)
      setTestEvaluations((prev) => ({
        ...prev,
        [campaignId]: [evaluation, ...(prev[campaignId] ?? [])],
      }))
    } catch (err) {
      setEvaluateErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not evaluate test plan.',
      }))
    } finally {
      setEvaluatingId(null)
    }
  }

  async function handleAnalyze(campaignId: string) {
    setAnalyzingId(campaignId)
    setAnalyzeErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const recommendation = await createRecommendation(businessId, campaignId)
      setRecommendations((prev) => ({
        ...prev,
        [campaignId]: [recommendation, ...(prev[campaignId] ?? [])],
      }))
    } catch (err) {
      setAnalyzeErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not analyze campaign.',
      }))
    } finally {
      setAnalyzingId(null)
    }
  }

  // Approving applies the recommendation to Meta immediately — one explicit
  // click both approves and acts, same "approve = act" shape as
  // "Approve & Publish" (PRD.md §5 step 10's checkpoint requirement).
  async function handleApproveRecommendation(campaignId: string, recommendationId: string) {
    setActingRecommendation({ id: recommendationId, action: 'approve' })
    setRecommendationErrors((prev) => ({ ...prev, [recommendationId]: '' }))
    try {
      const updated = await approveRecommendation(businessId, campaignId, recommendationId)
      setRecommendations((prev) => ({
        ...prev,
        [campaignId]: (prev[campaignId] ?? []).map((r) => (r.id === updated.id ? updated : r)),
      }))
    } catch (err) {
      setRecommendationErrors((prev) => ({
        ...prev,
        [recommendationId]:
          err instanceof ApiError ? err.message : 'Could not approve recommendation.',
      }))
    } finally {
      setActingRecommendation(null)
    }
  }

  async function handleRejectRecommendation(campaignId: string, recommendationId: string) {
    setActingRecommendation({ id: recommendationId, action: 'reject' })
    setRecommendationErrors((prev) => ({ ...prev, [recommendationId]: '' }))
    try {
      const updated = await rejectRecommendation(businessId, campaignId, recommendationId)
      setRecommendations((prev) => ({
        ...prev,
        [campaignId]: (prev[campaignId] ?? []).map((r) => (r.id === updated.id ? updated : r)),
      }))
    } catch (err) {
      setRecommendationErrors((prev) => ({
        ...prev,
        [recommendationId]:
          err instanceof ApiError ? err.message : 'Could not reject recommendation.',
      }))
    } finally {
      setActingRecommendation(null)
    }
  }

  const objectiveOptions = options?.objectives ?? []
  const objectiveLabels = toLabelMap(objectiveOptions)
  const statusLabels = toLabelMap(options?.campaignStatuses ?? [])
  const ctaLabels = toLabelMap(options?.ctas ?? [])
  const actionLabels = toLabelMap(options?.actionTypes ?? [])
  const eventVenueOptions = options?.eventVenues ?? []

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
        {!loading && !listError && campaigns.length > 0 && !showCreateForm && (
          <button type="button" onClick={() => setShowCreateForm(true)}>
            New campaign
          </button>
        )}
        <ul>
          {campaigns.map((campaign) => {
            const strategy = strategies[campaign.id]
            const strategyError = strategyErrors[campaign.id]
            const campaignCreatives = creatives[campaign.id] ?? []
            const creativeError = creativeErrors[campaign.id]
            const approveError = approveErrors[campaign.id]
            const pauseError = pauseErrors[campaign.id]
            const canPublish = ['PENDING_APPROVAL', 'APPROVED', 'FAILED'].includes(
              campaign.status,
            )
            const isLive = campaign.status === 'LIVE'
            const isPaused = campaign.status === 'PAUSED'
            const campaignMetrics = metrics[campaign.id] ?? []
            const metricError = metricErrors[campaign.id]
            const latestMetric = campaignMetrics[0]
            const campaignRecommendations = recommendations[campaign.id] ?? []
            const analyzeError = analyzeErrors[campaign.id]
            const campaignTestEvaluations = testEvaluations[campaign.id] ?? []
            const evaluateError = evaluateErrors[campaign.id]
            const selectedCreative = campaignCreatives.find((c) => c.status === 'SELECTED')
            // Own name (not just campaign.productId inline below) so its
            // narrowed non-null type survives into the JSX callbacks that
            // close over it — a plain property access re-widens to
            // `string | null` inside a nested closure.
            const campaignProductId = campaign.productId
            const currentProduct = products.find((p) => p.id === campaignProductId)
            const hasStaleCreatives = campaignCreatives.some((c) => c.isStale)
            return (
              <li key={campaign.id}>
                {campaign.name ? `${campaign.name} — ` : ''}
                {objectiveLabels[campaign.objective] ?? campaign.objective} —{' '}
                {statusLabels[campaign.status] ?? campaign.status}
                {campaign.eventVenueKey && (
                  <p>
                    Event:{' '}
                    {eventVenueOptions.find((v) => v.value === campaign.eventVenueKey)
                      ?.label ?? campaign.eventVenueKey}
                    {campaign.startDate && campaign.endDate && (
                      // Sliced, not parsed as a local Date — these are
                      // calendar dates stored at midnight UTC (see
                      // app/services/event_venues.py's default window),
                      // and converting through the viewer's local
                      // timezone can shift the displayed day by one.
                      <>
                        {' '}
                        ({campaign.startDate.slice(0, 10)} – {campaign.endDate.slice(0, 10)})
                      </>
                    )}
                  </p>
                )}
                <div
                  className="campaign-block"
                  aria-label={`Product for ${campaign.name ?? campaign.id}`}
                >
                  <p>
                    Product: {currentProduct ? currentProduct.description : 'No product selected'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProductForCampaignId(null)
                      setReuseProductForCampaignId(null)
                      setProductPickerId((prev) => (prev === campaign.id ? null : campaign.id))
                    }}
                  >
                    {currentProduct ? 'Change product' : 'Attach a product'}
                  </button>
                  {campaign.needsDestinationUrl && (
                    <p className="form-error" role="alert">
                      This product needs a destination link before you can publish a Sales or
                      Traffic campaign.{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setProductPickerId(campaign.id)
                          setReuseProductForCampaignId(null)
                          setEditingProductForCampaignId(campaign.id)
                        }}
                      >
                        Edit product
                      </button>
                    </p>
                  )}
                  {productPickerId === campaign.id &&
                    (editingProductForCampaignId === campaign.id && currentProduct ? (
                      <ProductForm
                        businessId={businessId}
                        product={currentProduct}
                        onSaved={() => {
                          setEditingProductForCampaignId(null)
                          setProductPickerId(null)
                          void refresh()
                        }}
                        onCancel={() => setEditingProductForCampaignId(null)}
                      />
                    ) : reuseProductForCampaignId === campaign.id ? (
                      <div className="button-row">
                        <select
                          aria-label="Change product"
                          value={pickProductId[campaign.id] ?? ''}
                          onChange={(event) =>
                            setPickProductId((prev) => ({
                              ...prev,
                              [campaign.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Choose a product…</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.description}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            void handleAttachToCampaign(campaign.id, {
                              productId: pickProductId[campaign.id],
                            })
                            setProductPickerId(null)
                          }}
                          disabled={!pickProductId[campaign.id] || attachingId === campaign.id}
                        >
                          Attach
                        </button>
                        <button
                          type="button"
                          onClick={() => setReuseProductForCampaignId(null)}
                        >
                          Add a new product instead
                        </button>
                      </div>
                    ) : (
                      <>
                        <ProductForm
                          businessId={businessId}
                          campaignId={campaign.id}
                          urlRequired={!currentProduct && requiresDestinationUrl(campaign.objective)}
                          onSaved={(created) => {
                            setReuseProductForCampaignId(null)
                            setProductPickerId(null)
                            void handleAttachToCampaign(campaign.id, { productId: created.id })
                          }}
                          onCancel={() => setProductPickerId(null)}
                        />
                        {products.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setReuseProductForCampaignId(campaign.id)}
                          >
                            Use an existing product instead
                          </button>
                        )}
                      </>
                    ))}
                  {attachErrors[campaign.id] && (
                    <p className="form-error" role="alert">
                      {attachErrors[campaign.id]}
                    </p>
                  )}
                </div>
                {hasStaleCreatives && (
                  <div
                    className="campaign-block"
                    aria-label={`Stale ads for ${campaign.name ?? campaign.id}`}
                  >
                    <p role="alert">
                      These ads were generated from an older version of the product. Regenerate?
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleGenerateCreatives(campaign.id)}
                      disabled={generatingCreativesId === campaign.id}
                    >
                      {generatingCreativesId === campaign.id ? 'Regenerating…' : 'Regenerate'}
                    </button>
                  </div>
                )}
                {campaign.status === 'DRAFT' ? (
                  <div aria-label={`Campaign readiness for ${campaign.name ?? campaign.id}`}>
                    <p>Campaign needs:</p>
                    <ul>
                      <li>✓ Objective</li>
                      <li>{campaign.productId ? '✓' : '✗'} Product</li>
                      <li>
                        {campaign.audienceId ? '✓' : '✗'} Audience
                        {!campaign.audienceId && audiencePickerId !== campaign.id && (
                          <>
                            {' '}
                            <button
                              type="button"
                              onClick={() => {
                                setReuseAudienceForCampaignId(null)
                                setAudiencePickerId(campaign.id)
                              }}
                            >
                              Attach an audience
                            </button>
                          </>
                        )}
                        {!campaign.audienceId &&
                          audiencePickerId === campaign.id &&
                          (reuseAudienceForCampaignId === campaign.id ? (
                            <div className="button-row">
                              <select
                                aria-label="Which audience?"
                                value={pickAudienceId[campaign.id] ?? ''}
                                onChange={(event) =>
                                  setPickAudienceId((prev) => ({
                                    ...prev,
                                    [campaign.id]: event.target.value,
                                  }))
                                }
                              >
                                <option value="">Which audience?</option>
                                {audiences.map((audience) => (
                                  <option key={audience.id} value={audience.id}>
                                    {audience.description}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleAttachToCampaign(campaign.id, {
                                    audienceId: pickAudienceId[campaign.id],
                                  })
                                  setAudiencePickerId(null)
                                }}
                                disabled={
                                  !pickAudienceId[campaign.id] || attachingId === campaign.id
                                }
                              >
                                Attach
                              </button>
                              <button
                                type="button"
                                onClick={() => setReuseAudienceForCampaignId(null)}
                              >
                                Add a new audience instead
                              </button>
                            </div>
                          ) : (
                            <div>
                              <AudienceForm
                                businessId={businessId}
                                campaignId={campaign.id}
                                onSaved={(created) => {
                                  setReuseAudienceForCampaignId(null)
                                  setAudiencePickerId(null)
                                  void handleAttachToCampaign(campaign.id, {
                                    audienceId: created.id,
                                  })
                                }}
                                onCancel={() => setAudiencePickerId(null)}
                              />
                              {audiences.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setReuseAudienceForCampaignId(campaign.id)}
                                >
                                  Use an existing audience instead
                                </button>
                              )}
                            </div>
                          ))}
                      </li>
                    </ul>
                  </div>
                ) : (
                  <>
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
                    {needsAdExperienceAnswerId === campaign.id && (
                      <fieldset>
                        <legend>Has this business run advertising campaigns before?</legend>
                        <div className="button-row">
                          <button
                            type="button"
                            onClick={() => handleGenerateStrategy(campaign.id, true)}
                            disabled={generatingId === campaign.id}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGenerateStrategy(campaign.id, false)}
                            disabled={generatingId === campaign.id}
                          >
                            No
                          </button>
                        </div>
                      </fieldset>
                    )}
                  </>
                )}
                {/* Once ads exist, the creatives are what the user acts on —
                    the strategy write-up that produced them is no longer
                    the useful thing to scroll past to reach them. */}
                {strategy && campaignCreatives.length === 0 && (
                  <div aria-label={`Strategy for ${campaign.name ?? campaign.id}`}>
                    <p>
                      <strong>Offer:</strong> {strategy.offer}
                    </p>
                    <p>
                      <strong>Positioning:</strong> {strategy.positioning}
                    </p>
                    {strategy.planType === 'TEST_PLAN' ? (
                      <>
                        <p>
                          <strong>Test plan</strong> — this business has no
                          meaningful advertising history yet. The purpose is
                          to collect real data, not assume a winner.
                        </p>
                        {strategy.audienceVariants.map((variant) => (
                          <div key={variant.id}>
                            <p>
                              <strong>
                                {variant.name}
                                {variant.isBaseline ? ' (baseline)' : ''}:
                              </strong>{' '}
                              {[
                                variant.targeting.ageMin != null &&
                                variant.targeting.ageMax != null
                                  ? `${variant.targeting.ageMin}-${variant.targeting.ageMax}`
                                  : null,
                                variant.targeting.genders?.join(', '),
                                formatLocations(variant.targeting.location),
                                variant.targeting.interests.join(', '),
                              ]
                                .filter(Boolean)
                                .join(' — ') || 'Broad — no targeting constraints'}
                            </p>
                            <p>{variant.hypothesis}</p>
                          </div>
                        ))}
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
                          <strong>Primary hypothesis:</strong>
                        </p>
                        <ul>
                          {strategy.hypotheses.map((hypothesis) => (
                            <li key={hypothesis.id}>
                              {hypothesis.statement} (measured by{' '}
                              {hypothesis.primaryMetric}, also tracking{' '}
                              {hypothesis.secondaryMetrics.join(', ')})
                            </li>
                          ))}
                        </ul>
                        <p>
                          <strong>Test budget:</strong> ${strategy.dailyBudget}/day per
                          variant for {strategy.durationDays} days (${strategy.totalBudget}{' '}
                          total across both variants)
                        </p>
                        <p>
                          <strong>Leading indicators (early signal):</strong>
                        </p>
                        <ul>
                          {strategy.successCriteria.leadingIndicators.map((criterion) => (
                            <li key={criterion.metric}>
                              <strong>{criterion.metric}:</strong>{' '}
                              {criterion.benchmark
                                ? `industry range ${criterion.benchmark.low}–${criterion.benchmark.high} (median ${criterion.benchmark.median})`
                                : 'no industry benchmark configured'}
                              {criterion.businessTarget != null &&
                                ` — business target: ${criterion.businessTarget}`}
                              {' — '}
                              {criterion.guidance}
                            </li>
                          ))}
                        </ul>
                        <p>
                          <strong>Economic indicators (need more volume):</strong>
                        </p>
                        <ul>
                          {strategy.successCriteria.economicIndicators.map((criterion) => (
                            <li key={criterion.metric}>
                              <strong>{criterion.metric}:</strong>{' '}
                              {criterion.benchmark
                                ? `industry range ${criterion.benchmark.low}–${criterion.benchmark.high} (median ${criterion.benchmark.median})`
                                : 'no industry benchmark configured'}
                              {criterion.businessTarget != null &&
                                ` — business target: ${criterion.businessTarget}`}
                              {' — '}
                              {criterion.guidance}
                            </li>
                          ))}
                        </ul>
                        <p>{strategy.successCriteria.profitabilityNote}</p>
                        <p>
                          <strong>Decision rules:</strong>
                        </p>
                        <ul>
                          {strategy.decisionRules.map((rule) => (
                            <li key={rule.action}>
                              If {rule.condition} → {rule.action.replaceAll('_', ' ')}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <>
                        <p>
                          <strong>Target audience:</strong>{' '}
                          {[
                            strategy.targetAudience.ageMin != null &&
                            strategy.targetAudience.ageMax != null
                              ? `${strategy.targetAudience.ageMin}-${strategy.targetAudience.ageMax}`
                              : null,
                            formatLocations(strategy.targetAudience.location),
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
                        <p>
                          <strong>Key learnings:</strong>
                        </p>
                        <ul>
                          {strategy.keyLearnings.map((learning) => (
                            <li key={learning}>{learning}</li>
                          ))}
                        </ul>
                        <p>
                          <strong>Recommended adjustments:</strong>
                        </p>
                        <ul>
                          {strategy.recommendedAdjustments.map((adjustment) => (
                            <li key={adjustment}>{adjustment}</li>
                          ))}
                        </ul>
                        <p>
                          <strong>Scaling trigger:</strong> {strategy.scalingTrigger}
                        </p>
                      </>
                    )}
                    {strategy.unitEconomics && (
                      <p>
                        <strong>Unit economics:</strong> gross profit $
                        {strategy.unitEconomics.grossProfit.toFixed(2)}, breakeven CAC $
                        {strategy.unitEconomics.breakevenCac.toFixed(2)}, target CAC $
                        {strategy.unitEconomics.targetCac.toFixed(2)}, breakeven ROAS{' '}
                        {strategy.unitEconomics.breakevenRoas.toFixed(2)}x
                      </p>
                    )}
                  </div>
                )}
                {strategy && (
                  <div
                    className="campaign-block"
                    aria-label={`Ads for ${campaign.name ?? campaign.id}`}
                  >
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
                    {campaignCreatives.length > 0 &&
                      (selectedCreative && !showAllCreatives[campaign.id] ? (
                        <div aria-label={`Selected ad for ${campaign.name ?? campaign.id}`}>
                          <button type="button" disabled>
                            Selected
                          </button>
                          {campaignProductId && (
                            <div className="image-picker">
                              <button
                                type="button"
                                onClick={() => handleToggleImageMenu(selectedCreative.id)}
                              >
                                {selectedCreative.imageUrl ? 'Change image' : 'Upload Image'}
                              </button>
                              {imageMenuId === selectedCreative.id && (
                                <div className="image-menu">
                                  <label htmlFor={`creative-image-upload-${selectedCreative.id}`}>
                                    Upload from computer
                                  </label>
                                  <input
                                    id={`creative-image-upload-${selectedCreative.id}`}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    disabled={uploadingImageId === selectedCreative.id}
                                    onChange={(event) =>
                                      void handleUploadCreativeImage(
                                        campaign.id,
                                        selectedCreative.id,
                                        campaignProductId,
                                        event,
                                      )
                                    }
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleOpenLibrary(
                                        selectedCreative.id,
                                        campaignProductId,
                                      )
                                    }
                                  >
                                    Choose from library
                                  </button>
                                </div>
                              )}
                              {uploadingImageId === selectedCreative.id && <p>Uploading…</p>}
                              {libraryId === selectedCreative.id && (
                                <div aria-label="Choose a photo from your library">
                                  {loadingLibraryId === selectedCreative.id && <p>Loading…</p>}
                                  {loadingLibraryId !== selectedCreative.id &&
                                    (productImages[campaignProductId] ?? []).length === 0 && (
                                      <p>No photos uploaded for this product yet.</p>
                                    )}
                                  {(productImages[campaignProductId] ?? []).map((image) => (
                                    <button
                                      key={image.id}
                                      type="button"
                                      onClick={() =>
                                        void handleAttachImageToCreative(
                                          campaign.id,
                                          selectedCreative.id,
                                          image.id,
                                        )
                                      }
                                    >
                                      <img
                                        src={image.url}
                                        alt="Product option"
                                        width={60}
                                        height={60}
                                        style={{ objectFit: 'cover' }}
                                      />
                                    </button>
                                  ))}
                                </div>
                              )}
                              {imageErrors[selectedCreative.id] && (
                                <p className="form-error" role="alert">
                                  {imageErrors[selectedCreative.id]}
                                </p>
                              )}
                            </div>
                          )}
                          <div className="ad-preview">
                            {selectedCreative.imageUrl && (
                              <img
                                src={selectedCreative.imageUrl}
                                alt="Selected ad"
                                width={320}
                                height={320}
                                style={{ objectFit: 'cover' }}
                              />
                            )}
                            <p className="ad-preview-headline">{selectedCreative.headline}</p>
                            <p className="ad-preview-body">{selectedCreative.bodyText}</p>
                            <p className="ad-preview-description">
                              {selectedCreative.description}
                            </p>
                            <p className="ad-preview-cta">
                              {ctaLabels[selectedCreative.cta] ?? selectedCreative.cta}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() =>
                              setShowAllCreatives((prev) => ({ ...prev, [campaign.id]: true }))
                            }
                          >
                            Choose a different ad
                          </button>
                        </div>
                      ) : (
                        <ul aria-label={`Ad creatives for ${campaign.name ?? campaign.id}`}>
                          {campaignCreatives.map((c, index) => (
                            <li key={c.id}>
                              <p>
                                <strong>
                                  Creative {VARIANT_LETTERS[index] ?? index + 1} —{' '}
                                  {c.status}
                                </strong>
                              </p>
                              {c.imageUrl && (
                                <img
                                  src={c.imageUrl}
                                  alt={`Creative ${VARIANT_LETTERS[index] ?? index + 1}`}
                                  width={160}
                                  height={160}
                                  style={{ objectFit: 'cover' }}
                                />
                              )}
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
                                <strong>CTA:</strong> {ctaLabels[c.cta] ?? c.cta}
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
                      ))}
                  </div>
                )}
                {canPublish && (
                  <div
                    className="campaign-block"
                    aria-label={`Publish ${campaign.name ?? campaign.id}`}
                  >
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
                  <div
                    className="campaign-block"
                    aria-label={`Live status for ${campaign.name ?? campaign.id}`}
                  >
                    <p>
                      Live on Meta
                      {campaign.metaCampaignId ? ` (id: ${campaign.metaCampaignId})` : ''}
                    </p>
                    {campaign.dailySpendFlag && (
                      <p role="alert">⚠ {campaign.dailySpendFlag}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => handlePause(campaign.id)}
                      disabled={pausingId === campaign.id}
                    >
                      {pausingId === campaign.id ? 'Pausing…' : 'Pause campaign'}
                    </button>
                    {pauseError && (
                      <p className="form-error" role="alert">
                        {pauseError}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRefreshMetrics(campaign.id)}
                      disabled={refreshingMetricsId === campaign.id}
                    >
                      {refreshingMetricsId === campaign.id
                        ? 'Refreshing…'
                        : 'Refresh results'}
                    </button>
                    {metricError && (
                      <p className="form-error" role="alert">
                        {metricError}
                      </p>
                    )}
                    {latestMetric && (
                      <div aria-label={`Results for ${campaign.name ?? campaign.id}`}>
                        <p>
                          <strong>Impressions:</strong> {latestMetric.impressions}
                          {' — '}
                          <strong>Clicks:</strong> {latestMetric.clicks}
                          {' — '}
                          <strong>Spend:</strong> ${latestMetric.spend}
                          {' — '}
                          <strong>Conversions:</strong> {latestMetric.conversions}
                        </p>
                        {campaignMetrics.length > 1 && (
                          <ul>
                            {campaignMetrics.slice(1).map((metric) => (
                              <li key={metric.id}>
                                {new Date(metric.fetchedAt).toLocaleString()} —{' '}
                                {metric.impressions} impressions, {metric.clicks} clicks,
                                ${metric.spend} spend, {metric.conversions} conversions
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleAnalyze(campaign.id)}
                      disabled={analyzingId === campaign.id}
                    >
                      {analyzingId === campaign.id ? 'Analyzing…' : 'Analyze now'}
                    </button>
                    {analyzeError && (
                      <p className="form-error" role="alert">
                        {analyzeError}
                      </p>
                    )}
                    {campaignRecommendations.length > 0 && (
                      <ul aria-label={`Recommendations for ${campaign.name ?? campaign.id}`}>
                        {campaignRecommendations.map((recommendation) => {
                          const recommendationError = recommendationErrors[recommendation.id]
                          const approving =
                            actingRecommendation?.id === recommendation.id &&
                            actingRecommendation.action === 'approve'
                          const rejecting =
                            actingRecommendation?.id === recommendation.id &&
                            actingRecommendation.action === 'reject'
                          const acting = approving || rejecting
                          // A LOW-risk, high-confidence budget nudge can apply itself
                          // with no human click (PRD.md §5 step 10's auto-apply tier) —
                          // shown distinctly so it isn't mistaken for something a human
                          // approved.
                          const statusLabel =
                            recommendation.status === 'APPLIED' && !recommendation.requiresApproval
                              ? 'Applied automatically'
                              : recommendation.status
                          return (
                            <li key={recommendation.id}>
                              <p>
                                <strong>
                                  {actionLabels[recommendation.actionType] ??
                                    recommendation.actionType}
                                </strong>
                                {' — '}
                                {statusLabel}
                                {' — '}
                                confidence {Math.round(recommendation.confidence * 100)}%,{' '}
                                {recommendation.risk.toLowerCase()} risk
                              </p>
                              <p>{recommendation.reasoning}</p>
                              {recommendation.suggestedBudget != null && (
                                <p>
                                  <strong>Suggested budget:</strong> $
                                  {recommendation.suggestedBudget}/day
                                </p>
                              )}
                              {recommendation.status === 'PENDING' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleApproveRecommendation(campaign.id, recommendation.id)
                                    }
                                    disabled={acting}
                                  >
                                    {approving ? 'Approving…' : 'Approve'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRejectRecommendation(campaign.id, recommendation.id)
                                    }
                                    disabled={acting}
                                  >
                                    {rejecting ? 'Rejecting…' : 'Reject'}
                                  </button>
                                </>
                              )}
                              {recommendationError && (
                                <p className="form-error" role="alert">
                                  {recommendationError}
                                </p>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {strategy?.planType === 'TEST_PLAN' && (
                      <div>
                        <button
                          type="button"
                          onClick={() => handleEvaluateTestPlan(campaign.id)}
                          disabled={evaluatingId === campaign.id}
                        >
                          {evaluatingId === campaign.id ? 'Evaluating…' : 'Evaluate test'}
                        </button>
                        {evaluateError && (
                          <p className="form-error" role="alert">
                            {evaluateError}
                          </p>
                        )}
                        {campaignTestEvaluations.length > 0 && (
                          <ul aria-label={`Test evaluations for ${campaign.name ?? campaign.id}`}>
                            {campaignTestEvaluations.map((evaluation) => (
                              <li key={evaluation.id}>
                                <p>
                                  <strong>{evaluation.status}</strong>
                                  {' — '}
                                  hypothesis: {evaluation.hypothesisResult.toLowerCase()}
                                  {' — '}
                                  confidence: {evaluation.confidence.toLowerCase()}
                                  {' — '}
                                  recommended: {evaluation.recommendedAction.replaceAll('_', ' ')}
                                </p>
                                <p>
                                  triggered by: {evaluation.stopReason.toLowerCase().replaceAll('_', ' ')}
                                </p>
                                <p>{evaluation.reasoning}</p>
                                {evaluation.keyFindings.length > 0 && (
                                  <ul>
                                    {evaluation.keyFindings.map((finding) => (
                                      <li key={finding}>{finding}</li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {isPaused && (
                  <p>
                    Paused
                    {campaign.pausedReason ? ` — ${campaign.pausedReason}` : ''}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {!loading && !listError && campaigns.length === 0 && (
        <section>
          <h2>Create a campaign</h2>
          {business && !business.description && (
            <p className="field-hint">
              Add a business description for stronger AI-generated strategy and ad copy.
            </p>
          )}
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
                {objectiveOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="event-venue">Event venue</label>
              <select
                id="event-venue"
                value={eventVenueKey}
                onChange={(event) => setEventVenueKey(event.target.value)}
              >
                <option value="">None — broad US targeting</option>
                {eventVenueOptions.map((venue) => (
                  <option key={venue.value} value={venue.value}>
                    {venue.label}
                  </option>
                ))}
              </select>
            </div>
            {eventVenueKey && (
              <>
                <div className="field">
                  <label htmlFor="event-start-date">Start date</label>
                  <input
                    id="event-start-date"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-end-date">End date</label>
                  <input
                    id="event-end-date"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
                <p>Leave dates blank to default to the venue's typical window.</p>
              </>
            )}
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
      )}

      {!loading && !listError && campaigns.length > 0 && showCreateForm && (
        <NewCampaignFlow
          businessId={businessId}
          products={products}
          audiences={audiences}
          objectiveOptions={objectiveOptions}
          eventVenueOptions={eventVenueOptions}
          onCancel={handleCancelCreate}
          onDone={() => {
            setShowCreateForm(false)
            void refresh()
          }}
        />
      )}
    </>
  )
}
