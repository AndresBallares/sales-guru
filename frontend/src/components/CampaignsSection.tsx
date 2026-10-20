import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ADS_LOCKED_NOTE, isPublished as isPublishedCampaign } from '../lib/publishedCampaign'
import { CampaignSetup, type SetupStep } from './CampaignSetup'
import { CreativeCard } from './CreativeCard'
import { CreativeEditor } from './CreativeEditor'
import { ActionRow } from './ActionRow'
import { ExtraAssetSlot } from './ExtraAssetSlot'
import { CardToolbar, type ToolbarAction } from './CardToolbar'
import { CarouselEditor } from './CarouselEditor'
import {
  ArrowRightIcon,
  ArchiveIcon,
  CheckIcon,
  CloseIcon,
  ImageIcon,
  PackageIcon,
  TargetIcon,
  FlaskIcon,
  LightbulbIcon,
  UsersIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  StatusIcon,
  StrategyIcon,
  TrashIcon,
  UndoIcon,
  VideoIcon,
  VoiceIcon,
} from './icons'
import { PublishFooter } from './PublishFooter'
import { onlyPhotos, PHOTOS_ONLY_HINT } from '../lib/media'
import { describePublishStatus, PublishJobError, waitForPublishJob } from '../lib/publishJob'
import {
  activateCampaign,
  ApiError,
  approveCampaign,
  approveRecommendation,
  createCampaign,
  createCreatives,
  createRecommendation,
  createStrategy,
  type PublishStatus,
  type StrategyMode,
  type TestFormat,
  archiveCampaign,
  createTestEvaluation,
  deleteCampaign,
  getBrandProfile,
  getBusiness,
  getOptions,
  getStrategy,
  restoreCampaign,
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
  removeCreativeCard,
  reorderCreativeCards,
  selectCreative,
  deselectCreative,
  toLabelMap,
  updateCampaign,
  uploadProductImage,
  type Audience,
  type Business,
  type Campaign,
  type Creative,
  type CreativeFormat,
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
import { InstagramNote } from './InstagramNote'
import { clearPublishPaused, getPublishPaused, setPublishPaused } from '../lib/publishPaused'
import { requiresDestinationUrl } from '../lib/urlValidation'
import { AudienceForm } from './AudienceForm'
import { NewCampaignFlow } from './NewCampaignFlow'
import { ProductForm } from './ProductForm'
import { SocialPostPreview } from './SocialPostPreview'

function formatLocations(locations: TargetLocation[]): string {
  return locations
    .map((loc) => [loc.city, loc.region].filter(Boolean).join(', '))
    .join('; ')
}

// A creative test (CREATIVE_TEST_PLAN) publishes 3-4 ads in one ad set — kept
// in step with the backend's MIN/MAX_CREATIVE_ANGLES (app/schemas/strategy.py).
const FORMAT_TAG_LABELS: Record<string, string> = {
  SINGLE_IMAGE: 'Image ad',
  SINGLE_VIDEO: 'Video ad',
  CAROUSEL: 'Carousel ad',
}

const MIN_TEST_ADS = 3
const MAX_TEST_ADS = 4

const VARIANT_LETTERS = ['A', 'B', 'C', 'D']

// Meta's own per-carousel-ad card limit (backend/app/schemas/creative.py's
// MAX_CAROUSEL_CARDS) — mirrored here only to show the "using the first N
// of M photos" note before generating; the backend enforces the cap
// either way.
const MAX_CAROUSEL_CARDS = 10

export function CampaignsSection({
  businessId,
  onCampaignsChange,
}: {
  businessId: string
  onCampaignsChange?: (campaigns: Campaign[]) => void
}) {
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  // Feeds the "add a business description" nudge on the create-campaign
  // step below, and the logo/name shown on a selected ad's
  // SocialPostPreview further down.
  const [business, setBusiness] = useState<Business | null>(null)
  // Only powers the "Regenerate with brand voice" label (PRD.md §5 step
  // 3.5) — whether the business has filled in a brand profile at all,
  // not the profile's content.
  const [hasBrandProfile, setHasBrandProfile] = useState(false)
  // The profile's price positioning, shown as a tag on a campaign card.
  const [brandPricePositioning, setBrandPricePositioning] = useState<string | null>(null)
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

  // Mirrors productPickerId above, for the audience form in the setup panel
  // below — collapsed by default (Continue setup opens it for one campaign at
  // a time) so it doesn't compete for the same field labels as
  // NewCampaignFlow's own audience step when both are open together.
  const [audiencePickerId, setAudiencePickerId] = useState<string | null>(null)

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
  // Which format to generate next — per campaign, defaults to
  // SINGLE_IMAGE (the pre-existing behavior) until the user picks
  // Carousel. Never inferred from anything else, per the design decision
  // to keep format an explicit, deliberate choice.
  const [strategyMode, setStrategyMode] = useState<Record<string, StrategyMode>>({})
  const [testFormat, setTestFormat] = useState<Record<string, TestFormat>>({})
  // A background (video) publish in flight, by campaign: what the button shows.
  const [publishStatuses, setPublishStatuses] = useState<Record<string, PublishStatus>>({})
  const watchingPublish = useRef(new Set<string>())
  const [creativeFormat, setCreativeFormat] = useState<Record<string, CreativeFormat>>({})
  // Reorder/remove state for a carousel creative's cards, keyed by
  // creative id — mirrors the productImages upload/reorder state further
  // down (uploadingImageId etc.) in shape.
  const [cardActionId, setCardActionId] = useState<string | null>(null)
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
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
  // "Publish paused" checkbox on the Approve & Publish step, default
  // checked (a campaign not yet in this map defaults to true below) —
  // publishing then creates everything PAUSED on Meta instead of ACTIVE.
  const [publishPaused, setPublishPausedState] = useState<Record<string, boolean>>({})
  const [pausingId, setPausingId] = useState<string | null>(null)
  const [pauseErrors, setPauseErrors] = useState<Record<string, string>>({})
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [activateErrors, setActivateErrors] = useState<Record<string, string>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({})
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [archiveErrors, setArchiveErrors] = useState<Record<string, string>>({})
  // Which campaign is waiting on the delete/archive confirmation, and which.
  const [confirmingAction, setConfirmingAction] = useState<
    Record<string, 'delete' | 'archive' | undefined>
  >({})
  // A campaign the server refused to delete because it turned out to have
  // delivered (its results hadn't been collected yet): Archive is offered instead.
  const [deliveredOverride, setDeliveredOverride] = useState<Record<string, boolean>>({})
  const [showArchived, setShowArchived] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreErrors, setRestoreErrors] = useState<Record<string, string>>({})

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

      // Best-effort too — only powers the "Regenerate with brand voice"
      // label below (PRD.md §5 step 3.5). A 404 (no profile yet) is the
      // expected default state, not a failure to surface.
      getBrandProfile(businessId)
        .then((profile) => {
          setHasBrandProfile(true)
          setBrandPricePositioning(profile.pricePositioning)
        })
        .catch(() => {
          setHasBrandProfile(false)
          setBrandPricePositioning(null)
        })

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

  // A page reload mid-publish: the server still reports the campaign as
  // publishing, so pick the progress display back up.
  useEffect(() => {
    for (const campaign of campaigns) {
      if (!campaign.publishing || watchingPublish.current.has(campaign.id)) continue
      const campaignId = campaign.id
      void watchPublish(campaignId)
        .then(() => refresh())
        .catch((err: unknown) =>
          setApproveErrors((prev) => ({
            ...prev,
            [campaignId]:
              err instanceof PublishJobError ? err.message : 'Could not publish campaign.',
          })),
        )
    }
    // watchPublish only closes over businessId and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns])

  async function handleGenerateStrategy(campaignId: string, hasPriorAdvertisingExperience?: boolean) {
    setGeneratingId(campaignId)
    setStrategyErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const strategy = await createStrategy(
        businessId,
        campaignId,
        hasPriorAdvertisingExperience,
        strategyMode[campaignId],
        // The test format only means something for a creative test.
        strategyMode[campaignId] === 'STANDARD' ? undefined : testFormat[campaignId],
      )
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
      const plan = strategies[campaignId]
      // A creative test's format is fixed by the plan; anything else is the
      // user's per-campaign ad-format choice.
      const format =
        plan?.planType === 'CREATIVE_TEST_PLAN'
          ? (plan.creativeFormat ?? 'SINGLE_IMAGE')
          : (creativeFormat[campaignId] ?? creatives[campaignId]?.[0]?.format ?? 'SINGLE_IMAGE')
      const generated = await createCreatives(businessId, campaignId, format)
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

  async function handleReorderCreativeCards(
    campaignId: string,
    creativeId: string,
    cardIds: string[],
  ) {
    setCardActionId(creativeId)
    setCardErrors((prev) => ({ ...prev, [creativeId]: '' }))
    try {
      const updated = await reorderCreativeCards(businessId, campaignId, creativeId, cardIds)
      setCreatives((prev) => ({
        ...prev,
        [campaignId]: (prev[campaignId] ?? []).map((c) => (c.id === updated.id ? updated : c)),
      }))
    } catch (err) {
      setCardErrors((prev) => ({
        ...prev,
        [creativeId]: err instanceof ApiError ? err.message : 'Could not reorder cards.',
      }))
    } finally {
      setCardActionId(null)
    }
  }

  async function handleRemoveCreativeCard(campaignId: string, creativeId: string, cardId: string) {
    setCardActionId(creativeId)
    setCardErrors((prev) => ({ ...prev, [creativeId]: '' }))
    try {
      const updated = await removeCreativeCard(businessId, campaignId, creativeId, cardId)
      setCreatives((prev) => ({
        ...prev,
        [campaignId]: (prev[campaignId] ?? []).map((c) => (c.id === updated.id ? updated : c)),
      }))
    } catch (err) {
      setCardErrors((prev) => ({
        ...prev,
        [creativeId]: err instanceof ApiError ? err.message : 'Could not remove card.',
      }))
    } finally {
      setCardActionId(null)
    }
  }

  // Creative test: ads are added to / removed from the test one at a time,
  // nothing is rejected and nothing navigates away — the user builds up 3-4
  // ads, then chooses "Review & publish".
  async function handleToggleTestAd(
    campaignId: string,
    creativeId: string,
    isSelected: boolean,
  ) {
    setSelectingId(creativeId)
    setCreativeErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const updated = isSelected
        ? await deselectCreative(businessId, campaignId, creativeId)
        : await selectCreative(businessId, campaignId, creativeId)
      setCreatives((prev) => ({
        ...prev,
        [campaignId]: (prev[campaignId] ?? []).map((c) => (c.id === updated.id ? updated : c)),
      }))
      // The backend moves the campaign to/from PENDING_APPROVAL as the
      // selected count crosses the minimum — refresh to pick that up.
      await refresh()
    } catch (err) {
      setCreativeErrors((prev) => ({
        ...prev,
        [campaignId]:
          err instanceof ApiError
            ? err.message
            : isSelected
              ? 'Could not remove ad.'
              : 'Could not add ad.',
      }))
    } finally {
      setSelectingId(null)
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
      setProductImages((prev) => ({ ...prev, [productId]: onlyPhotos(images) }))
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
  // Polls a background publish to its end, mirroring its progress into
  // publishStatuses (cleared once it finishes either way). Throws its error.
  async function watchPublish(campaignId: string) {
    watchingPublish.current.add(campaignId)
    try {
      await waitForPublishJob(businessId, campaignId, (status) =>
        setPublishStatuses((prev) => ({ ...prev, [campaignId]: status })),
      )
    } finally {
      watchingPublish.current.delete(campaignId)
      setPublishStatuses((prev) => {
        const { [campaignId]: _done, ...rest } = prev
        return rest
      })
    }
  }

  async function handleApproveAndPublish(campaignId: string, currentStatus: string) {
    setApprovingId(campaignId)
    setApproveErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      if (currentStatus === 'PENDING_APPROVAL') {
        await approveCampaign(businessId, campaignId)
      }
      // publishPaused defaults to checked (true) — a campaign not yet in
      // the map hasn't had its checkbox touched.
      const paused = publishPaused[campaignId] ?? getPublishPaused(campaignId)
      const published = await publishCampaign(businessId, campaignId, { paused })
      // A video publish runs as a background job (uploading and processing
      // takes minutes): wait for it, showing its progress.
      if (published.publishing) await watchPublish(campaignId)
      clearPublishPaused(campaignId)
      setPublishPausedState((prev) => {
        const { [campaignId]: _published, ...rest } = prev
        return rest
      })
      await refresh()
    } catch (err) {
      setApproveErrors((prev) => ({
        ...prev,
        [campaignId]:
          err instanceof ApiError || err instanceof PublishJobError
            ? err.message
            : 'Could not publish campaign.',
      }))
    } finally {
      setApprovingId(null)
    }
  }

  // The one-click "stop spending" action — pauses every AdSet in the
  // campaign, not just one Ad (distinct from an Optimizer PAUSE_AD
  // recommendation, which only ever pauses one). No confirmation dialog
  // here on purpose: this is itself the explicit, deliberate action, and
  // it's always reversible on Meta's side (a paused AdSet can be resumed
  // there) — this app's own Activate button (handleActivate below) only
  // ever applies to a campaign published paused and never yet activated,
  // deliberately not a general resume for a campaign paused this way.
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

  // Only ever enabled for a campaign published with "Publish paused" and
  // never since touched (pausedReason === 'Published paused') — the
  // backend 400s otherwise. Distinct from handlePause's reasoning above:
  // this campaign was never actually live, so there's no "re-evaluate
  // why it stopped" concern to gate on.
  async function handleActivate(campaignId: string) {
    setActivatingId(campaignId)
    setActivateErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      await activateCampaign(businessId, campaignId)
      await refresh()
    } catch (err) {
      setActivateErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not activate campaign.',
      }))
    } finally {
      setActivatingId(null)
    }
  }

  // Delete is for a campaign that never delivered: the server removes it on Meta
  // first and then locally, and refuses (409) if it has results, in which case
  // Archive is offered instead. Both go through a confirmation.
  async function handleDelete(campaignId: string) {
    setDeletingId(campaignId)
    setDeleteErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      await deleteCampaign(businessId, campaignId)
      setConfirmingAction((prev) => ({ ...prev, [campaignId]: undefined }))
      setCampaigns((prev) => {
        const next = prev.filter((c) => c.id !== campaignId)
        onCampaignsChange?.(next)
        return next
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeliveredOverride((prev) => ({ ...prev, [campaignId]: true }))
      }
      setConfirmingAction((prev) => ({ ...prev, [campaignId]: undefined }))
      setDeleteErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not delete campaign.',
      }))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleArchive(campaignId: string) {
    setArchivingId(campaignId)
    setArchiveErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const archived = await archiveCampaign(businessId, campaignId)
      setConfirmingAction((prev) => ({ ...prev, [campaignId]: undefined }))
      setCampaigns((prev) => {
        const next = prev.map((c) => (c.id === campaignId ? archived : c))
        onCampaignsChange?.(next)
        return next
      })
    } catch (err) {
      setConfirmingAction((prev) => ({ ...prev, [campaignId]: undefined }))
      setArchiveErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not archive campaign.',
      }))
    } finally {
      setArchivingId(null)
    }
  }

  // Restore brings an archived campaign back as paused. Nothing is sent to Meta.
  async function handleRestore(campaignId: string) {
    setRestoringId(campaignId)
    setRestoreErrors((prev) => ({ ...prev, [campaignId]: '' }))
    try {
      const restored = await restoreCampaign(businessId, campaignId)
      setCampaigns((prev) => {
        const next = prev.map((c) => (c.id === campaignId ? restored : c))
        onCampaignsChange?.(next)
        return next
      })
    } catch (err) {
      setRestoreErrors((prev) => ({
        ...prev,
        [campaignId]: err instanceof ApiError ? err.message : 'Could not restore campaign.',
      }))
    } finally {
      setRestoringId(null)
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
  // Archived campaigns are hidden unless "Show archived" is on.
  const archivedCount = campaigns.filter((c) => c.status === 'ARCHIVED').length
  const visibleCampaigns = showArchived
    ? campaigns
    : campaigns.filter((c) => c.status !== 'ARCHIVED')

  return (
    <>
      <section>
        <div className="section-header">
          <h2>Campaigns</h2>
          {!loading && !listError && campaigns.length > 0 && !showCreateForm && (
            <button
              type="button"
              className="section-action-button"
              onClick={() => setShowCreateForm(true)}
            >
              <PlusIcon />
              Create campaign
            </button>
          )}
        </div>
        {loading && <p>Loading…</p>}
        {listError && (
          <p className="form-error" role="alert">
            {listError}
          </p>
        )}
        {!loading && !listError && campaigns.length === 0 && (
          <p>No campaigns yet — create your first one below.</p>
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
        {archivedCount > 0 && (
          <label className="show-archived">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />{' '}
            Show archived ({archivedCount})
          </label>
        )}
        <ul>
          {visibleCampaigns.map((campaign) => {
            if (campaign.status === 'ARCHIVED') {
              return (
                <li key={campaign.id} className="campaign-archived">
                  {campaign.name ? `${campaign.name} — ` : ''}
                  {objectiveLabels[campaign.objective] ?? campaign.objective} —{' '}
                  {statusLabels[campaign.status] ?? campaign.status}
                  <p className="field-hint">
                    Paused on Meta and hidden from your list. Its results are kept.
                  </p>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => void handleRestore(campaign.id)}
                    disabled={restoringId === campaign.id}
                  >
                    <UndoIcon />
                    {restoringId === campaign.id ? 'Restoring…' : 'Restore campaign'}
                  </button>
                  {restoreErrors[campaign.id] && (
                    <p role="alert">{restoreErrors[campaign.id]}</p>
                  )}
                </li>
              )
            }
            const strategy = strategies[campaign.id]
            const strategyError = strategyErrors[campaign.id]
            const campaignCreatives = creatives[campaign.id] ?? []
            const creativeError = creativeErrors[campaign.id]
            const approveError = approveErrors[campaign.id]
            const pauseError = pauseErrors[campaign.id]
            const activateError = activateErrors[campaign.id]
            const isPublished = isPublishedCampaign(campaign)
            const canPublish =
              !isPublished && ['PENDING_APPROVAL', 'APPROVED', 'FAILED'].includes(campaign.status)
            const isLive = campaign.status === 'LIVE'
            const isPaused = campaign.status === 'PAUSED'
            // Exact match with the backend's PUBLISHED_PAUSED_REASON
            // (app/services/publish.py) — a campaign paused any other way
            // (manual pause, duration-elapsed, a circuit breaker) can't be
            // activated from here; only Meta's own Ads Manager can.
            const isActivatable = isPaused && campaign.pausedReason === 'Published paused'
            const campaignMetrics = metrics[campaign.id] ?? []
            const metricError = metricErrors[campaign.id]
            const latestMetric = campaignMetrics[0]
            const campaignRecommendations = recommendations[campaign.id] ?? []
            const analyzeError = analyzeErrors[campaign.id]
            const campaignTestEvaluations = testEvaluations[campaign.id] ?? []
            const evaluateError = evaluateErrors[campaign.id]
            const selectedCreative = campaignCreatives.find((c) => c.status === 'SELECTED')
            const isCreativeTest = strategy?.planType === 'CREATIVE_TEST_PLAN'
            // A creative test's format is fixed by its plan; otherwise it is the
            // user's per-campaign ad-format choice.
            const planFormat =
              strategy?.planType === 'CREATIVE_TEST_PLAN'
                ? (strategy.creativeFormat ?? 'SINGLE_IMAGE')
                : null
            // Before the user picks one (e.g. after a reload), show the format the
            // existing ads already are.
            const effectiveFormat =
              planFormat ??
              creativeFormat[campaign.id] ??
              campaignCreatives[0]?.format ??
              'SINGLE_IMAGE'
            const testAdCount = campaignCreatives.filter((c) => c.status === 'SELECTED').length
            // Own name (not just campaign.productId inline below) so its
            // narrowed non-null type survives into the JSX callbacks that
            // close over it — a plain property access re-widens to
            // `string | null` inside a nested closure.
            const campaignProductId = campaign.productId
            const currentProduct = products.find((p) => p.id === campaignProductId)
            const hasStaleCreatives = campaignCreatives.some((c) => c.isStale)
            const strategyControls =
              campaign.status !== 'DRAFT' ? (
                <>
                    {campaign.metaCampaignId !== null ? (
                      <p className="field-hint">
                        This campaign is already published, so its strategy can't be regenerated.
                        Create a new campaign to try a different strategy.
                      </p>
                    ) : (
                      // With a strategy already, Regenerate strategy lives in the
                      // card's editing toolbar instead.
                      !strategy && (
                        <button
                          type="button"
                          className="btn-generate"
                          onClick={() => handleGenerateStrategy(campaign.id)}
                          disabled={generatingId === campaign.id}
                        >
                          {generatingId === campaign.id ? (
                            'Generating…'
                          ) : (
                            <>
                              Generate strategy
                              <ArrowRightIcon />
                            </>
                          )}
                        </button>
                      )
                    )}
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
              ) : null
            const formatPicker = !isPublished ? (
              <>
                    <fieldset className="format-picker segmented">
                      <legend className="visually-hidden">Ad format</legend>
                      <label>
                        <input
                          type="radio"
                          name={`creative-format-${campaign.id}`}
                          checked={effectiveFormat === 'SINGLE_IMAGE'}
                          disabled={isCreativeTest}
                          onChange={() =>
                            setCreativeFormat((prev) => ({ ...prev, [campaign.id]: 'SINGLE_IMAGE' }))
                          }
                        />
                        Single image
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`creative-format-${campaign.id}`}
                          checked={effectiveFormat === 'SINGLE_VIDEO'}
                          disabled={isCreativeTest}
                          onChange={() =>
                            setCreativeFormat((prev) => ({ ...prev, [campaign.id]: 'SINGLE_VIDEO' }))
                          }
                        />
                        Single video
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`creative-format-${campaign.id}`}
                          checked={effectiveFormat === 'CAROUSEL'}
                          disabled={isCreativeTest}
                          onChange={() => {
                            setCreativeFormat((prev) => ({ ...prev, [campaign.id]: 'CAROUSEL' }))
                            if (campaignProductId && !productImages[campaignProductId]) {
                              void listProductImages(businessId, campaignProductId).then(
                                (images) =>
                                  setProductImages((prev) => ({
                                    ...prev,
                                    [campaignProductId]: onlyPhotos(images),
                                  })),
                              )
                            }
                          }}
                        />
                        Carousel
                      </label>
                    </fieldset>
              </>
            ) : null
            const formatHints = !isPublished ? (
              <>
                    {isCreativeTest && planFormat === 'SINGLE_VIDEO' && (
                      <p className="field-hint">
                        This is a video test: every ad is a video, so any difference in results
                        comes from the message, not the format. Pick the video for each ad below;
                        one video can back all of them.
                      </p>
                    )}
                    {isCreativeTest && planFormat !== 'SINGLE_VIDEO' && (
                      <p className="field-hint">
                        Carousel isn&apos;t part of Test #1. The first test compares single-image ads
                        so any difference in results comes from the creative, not the format.
                        Once it has run, a carousel is a good next experiment, or start a standard
                        campaign now.
                      </p>
                    )}
                    {creativeFormat[campaign.id] === 'CAROUSEL' &&
                      campaignProductId &&
                      (productImages[campaignProductId]?.length ?? 0) > MAX_CAROUSEL_CARDS && (
                        <p className="field-hint">
                          Using the first {MAX_CAROUSEL_CARDS} of{' '}
                          {productImages[campaignProductId]?.length} photos — reorder product
                          photos to change which are included.
                        </p>
                      )}
              </>
            ) : null
            const adsBusy = generatingCreativesId === campaign.id
            const strategyBusy = generatingId === campaign.id
            const pausedChoice = publishPaused[campaign.id] ?? getPublishPaused(campaign.id)
            const isPublishing = approvingId === campaign.id || campaign.id in publishStatuses
            const editingActions: ToolbarAction[] = []
            if (!isPublished && !(campaign.status === 'DRAFT' && !currentProduct)) {
              editingActions.push({
                key: 'product',
                label: currentProduct ? 'Change product' : 'Attach a product',
                icon: <PackageIcon />,
                expanded: productPickerId === campaign.id,
                onClick: () => {
                  setEditingProductForCampaignId(null)
                  setReuseProductForCampaignId(null)
                  setProductPickerId((prev) => (prev === campaign.id ? null : campaign.id))
                },
              })
            }
            if (strategy && !isPublished) {
              // One ad-regeneration action: with a brand profile the backend applies
              // the brand voice to every generation, so the same button just says so.
              const hasAds = campaignCreatives.length > 0
              editingActions.push({
                key: 'ads',
                label: adsBusy
                  ? 'Generating ads…'
                  : hasAds
                    ? hasBrandProfile
                      ? 'Regenerate with brand voice'
                      : 'Regenerate ads'
                    : 'Generate ads',
                icon: hasAds && hasBrandProfile ? <VoiceIcon /> : <RefreshIcon />,
                busy: adsBusy,
                disabled: adsBusy,
                onClick: () => void handleGenerateCreatives(campaign.id),
              })
              if (campaign.status !== 'DRAFT') {
                editingActions.push({
                  key: 'strategy',
                  label: strategyBusy ? 'Generating strategy…' : 'Regenerate strategy',
                  icon: <StrategyIcon />,
                  busy: strategyBusy,
                  disabled: strategyBusy,
                  onClick: () => void handleGenerateStrategy(campaign.id),
                })
              }
            }
            const isDraft = campaign.status === 'DRAFT'
            const objectiveLabel = objectiveLabels[campaign.objective] ?? campaign.objective
            const cardTitle = campaign.name ?? objectiveLabel
            const cardSubtitle =
              [campaign.name ? objectiveLabel : null, isDraft ? null : currentProduct?.description]
                .filter(Boolean)
                .join(' · ')
            const removeAction = !confirmingAction[campaign.id] && (
              campaign.hasDelivered || deliveredOverride[campaign.id] ? (
                <button
                  type="button"
                  className="campaign-card-link"
                  aria-label="Archive campaign"
                  onClick={() =>
                    setConfirmingAction((prev) => ({ ...prev, [campaign.id]: 'archive' }))
                  }
                >
                  <ArchiveIcon size={16} />
                  Archive
                </button>
              ) : (
                <button
                  type="button"
                  className="campaign-card-link campaign-card-link-danger"
                  aria-label="Delete campaign"
                  onClick={() =>
                    setConfirmingAction((prev) => ({ ...prev, [campaign.id]: 'delete' }))
                  }
                >
                  <TrashIcon size={16} />
                  Delete
                </button>
              )
            )
            const openProductPicker = () => {
              setEditingProductForCampaignId(null)
              setReuseProductForCampaignId(null)
              setProductPickerId(campaign.id)
            }
            const openAudiencePicker = () => setAudiencePickerId(campaign.id)
            const setupSteps: SetupStep[] = [
              {
                key: 'objective',
                label: 'Campaign objective',
                icon: <TargetIcon />,
                done: true,
                doneText: `${objectiveLabel} selected`,
                missingText: '',
                onAction: () => {},
              },
              {
                key: 'product',
                label: 'Choose a product',
                icon: <PackageIcon />,
                done: campaign.productId !== null,
                doneText: currentProduct?.description ?? 'Product selected',
                missingText: 'Select what you want to advertise',
                onAction: openProductPicker,
              },
              {
                key: 'audience',
                label: 'Attach an audience',
                icon: <UsersIcon />,
                done: campaign.audienceId !== null,
                doneText:
                  audiences.find((audience) => audience.id === campaign.audienceId)?.description ??
                  'Audience attached',
                missingText: 'Choose who should see your ads',
                onAction: openAudiencePicker,
                children:
                  !campaign.audienceId && audiencePickerId === campaign.id ? (
                    <AudienceForm
                      businessId={businessId}
                      campaignId={campaign.id}
                      onSaved={(created) => {
                        setAudiencePickerId(null)
                        void handleAttachToCampaign(campaign.id, {
                          audienceId: created.id,
                        })
                      }}
                      onCancel={() => setAudiencePickerId(null)}
                    />
                  ) : null,
              },
            ]
            const nextSetupStep = setupSteps.find((step) => !step.done)
            const productThumb = currentProduct?.primaryImageUrl ? (
              <img
                src={currentProduct.primaryImageUrl}
                alt={currentProduct.description}
                width={80}
                height={80}
                className="campaign-thumb"
              />
            ) : (
              currentProduct && (
                <span className="campaign-thumb campaign-thumb-empty" aria-hidden="true">
                  <PackageIcon />
                </span>
              )
            )
            // Ready to generate a strategy: no strategy yet and nothing published to Meta.
            const preStrategy = !isDraft && !strategy && campaign.metaCampaignId === null
            const isSalesCampaign = campaign.objective === 'SALES'
            const standardMode = strategyMode[campaign.id] === 'STANDARD'
            const statusPill = (
              <span className="status-pill" data-status={campaign.status}>
                <StatusIcon status={campaign.status} />
                {statusLabels[campaign.status] ?? campaign.status}
              </span>
            )
            const splitCard = preStrategy ? (
              <div className="config-card">
                <div className="config-main">
                  <div className="config-product">
                    {productThumb}
                    <div className="config-product-text">
                      <h3 className="campaign-card-title">
                        {currentProduct?.description ?? cardTitle}
                      </h3>
                      <p className="config-meta">
                        <span className="config-badge">{objectiveLabel}</span>
                        {campaign.name && <span>{campaign.name}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="config-rows">
                    <div className="config-row">
                      <span className="config-row-icon" aria-hidden="true">
                        <TargetIcon />
                      </span>
                      <span className="config-row-label">Campaign type</span>
                      <div className="config-row-value">{objectiveLabel}</div>
                    </div>
                    {isSalesCampaign && (
                      <fieldset className="config-row">
                        <legend className="visually-hidden">Test format</legend>
                        <span className="config-row-icon" aria-hidden="true">
                          <FlaskIcon />
                        </span>
                        <span className="config-row-label" aria-hidden="true">
                          Test format
                        </span>
                        <div className="config-row-value config-choices">
                          <label>
                            <input
                              type="radio"
                              name={`strategy-mode-${campaign.id}`}
                              checked={(strategyMode[campaign.id] ?? 'CREATIVE_TEST') === 'CREATIVE_TEST'}
                              onChange={() =>
                                setStrategyMode((prev) => ({ ...prev, [campaign.id]: 'CREATIVE_TEST' }))
                              }
                            />
                            Creative test (recommended for a first campaign)
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`strategy-mode-${campaign.id}`}
                              checked={standardMode}
                              onChange={() =>
                                setStrategyMode((prev) => ({ ...prev, [campaign.id]: 'STANDARD' }))
                              }
                            />
                            Standard campaign (allows carousel)
                          </label>
                        </div>
                      </fieldset>
                    )}
                    {isSalesCampaign &&
                      (standardMode ? (
                        <div className="config-row">
                          <span className="config-row-icon" aria-hidden="true">
                            <ImageIcon />
                          </span>
                          <span className="config-row-label">Media</span>
                          <div className="config-row-value">
                            Image, video or carousel, chosen per ad after the strategy
                          </div>
                        </div>
                      ) : (
                        <fieldset className="config-row">
                          <legend className="visually-hidden">Media</legend>
                          <span className="config-row-icon" aria-hidden="true">
                            <ImageIcon />
                          </span>
                          <span className="config-row-label" aria-hidden="true">
                            Media
                          </span>
                          <div className="config-row-value config-choices">
                            <label>
                              <input
                                type="radio"
                                name={`test-format-${campaign.id}`}
                                checked={(testFormat[campaign.id] ?? 'IMAGE') === 'IMAGE'}
                                onChange={() =>
                                  setTestFormat((prev) => ({ ...prev, [campaign.id]: 'IMAGE' }))
                                }
                              />
                              Images
                            </label>
                            <label>
                              <input
                                type="radio"
                                name={`test-format-${campaign.id}`}
                                checked={testFormat[campaign.id] === 'VIDEO'}
                                onChange={() =>
                                  setTestFormat((prev) => ({ ...prev, [campaign.id]: 'VIDEO' }))
                                }
                              />
                              Videos
                            </label>
                            <p className="field-hint">
                              Every ad in the test shares one format, so any difference in results
                              comes from the message, not the format. A video test can reuse one
                              video across all its ads with different copy.
                            </p>
                          </div>
                        </fieldset>
                      ))}
                  </div>
                </div>
                <div className="config-top">
                  {statusPill}
                  {removeAction}
                </div>
                <div className="config-panel">
                  <div className="config-panel-head">
                    <span className="config-bulb" aria-hidden="true">
                      <LightbulbIcon />
                    </span>
                    <h4>Ready to generate your strategy?</h4>
                  </div>
                  <p>
                    You&apos;ve selected your product, objective and audience. Now let Sales Guru
                    create a campaign strategy based on your settings.
                  </p>
                  {strategyControls}
                </div>
              </div>
            ) : null
            return (
              <li key={campaign.id} className="campaign-card">
                {splitCard ?? (
                <div className="campaign-card-header">
                  {productThumb}
                  <div className="campaign-card-heading">
                    <h3 className="campaign-card-title">{cardTitle}</h3>
                    {cardSubtitle && <p className="campaign-card-subtitle">{cardSubtitle}</p>}
                  </div>
                  <div className="campaign-card-side">
                    {statusPill}
                    {!isDraft && removeAction}
                  </div>
                </div>
                )}
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
                {confirmingAction[campaign.id] === 'delete' ? (
                  <div role="alertdialog" aria-label="Delete this campaign?" className="confirm-panel">
                    <p>
                      {campaign.metaCampaignId === null
                        ? 'This removes the campaign from Sales Guru. It never ran, so no results are lost.'
                        : 'This removes the campaign from Sales Guru and from Meta Ads Manager. It never ran, so no results are lost.'}
                    </p>
                    <div className="button-row">
                      <button
                        type="button"
                        onClick={() => void handleDelete(campaign.id)}
                        disabled={deletingId === campaign.id}
                      >
                        {deletingId === campaign.id ? 'Deleting…' : 'Delete campaign'}
                      </button>
                      <button
                        type="button"
                        className="cancel-link"
                        onClick={() =>
                          setConfirmingAction((prev) => ({ ...prev, [campaign.id]: undefined }))
                        }
                        disabled={deletingId === campaign.id}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : confirmingAction[campaign.id] === 'archive' ? (
                  <div role="alertdialog" aria-label="Archive this campaign?" className="confirm-panel">
                    <p>This pauses the campaign on Meta and hides it here. Its results are kept.</p>
                    <div className="button-row">
                      <button
                        type="button"
                        onClick={() => void handleArchive(campaign.id)}
                        disabled={archivingId === campaign.id}
                      >
                        {archivingId === campaign.id ? 'Archiving…' : 'Archive campaign'}
                      </button>
                      <button
                        type="button"
                        className="cancel-link"
                        onClick={() =>
                          setConfirmingAction((prev) => ({ ...prev, [campaign.id]: undefined }))
                        }
                        disabled={archivingId === campaign.id}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                {deleteErrors[campaign.id] && (
                  <p role="alert">{deleteErrors[campaign.id]}</p>
                )}
                {archiveErrors[campaign.id] && (
                  <p role="alert">{archiveErrors[campaign.id]}</p>
                )}
                {(isPublished || campaign.needsDestinationUrl) && (
                <div
                  className="campaign-block"
                  aria-label={`Product for ${campaign.name ?? campaign.id}`}
                >
                  {isPublished && <p className="field-hint">{ADS_LOCKED_NOTE}</p>}
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
                </div>
                )}
                {isDraft ? (
                  <CampaignSetup
                    ariaLabel={`Campaign readiness for ${campaign.name ?? campaign.id}`}
                    steps={setupSteps}
                  />
                ) : (
                  <>
                    {!preStrategy && (
                      <>
                    {campaign.objective === 'SALES' && !strategy && (
                      <fieldset className="strategy-mode-picker">
                        <legend>Campaign type</legend>
                        <label>
                          <input
                            type="radio"
                            name={`strategy-mode-${campaign.id}`}
                            checked={(strategyMode[campaign.id] ?? 'CREATIVE_TEST') === 'CREATIVE_TEST'}
                            onChange={() =>
                              setStrategyMode((prev) => ({ ...prev, [campaign.id]: 'CREATIVE_TEST' }))
                            }
                          />
                          Creative test (recommended for a first campaign)
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`strategy-mode-${campaign.id}`}
                            checked={strategyMode[campaign.id] === 'STANDARD'}
                            onChange={() =>
                              setStrategyMode((prev) => ({ ...prev, [campaign.id]: 'STANDARD' }))
                            }
                          />
                          Standard campaign (allows carousel)
                        </label>
                      </fieldset>
                    )}
                    {campaign.objective === 'SALES' &&
                      !strategy &&
                      strategyMode[campaign.id] !== 'STANDARD' && (
                        <fieldset className="strategy-mode-picker">
                          <legend>Test format</legend>
                          <label>
                            <input
                              type="radio"
                              name={`test-format-${campaign.id}`}
                              checked={(testFormat[campaign.id] ?? 'IMAGE') === 'IMAGE'}
                              onChange={() =>
                                setTestFormat((prev) => ({ ...prev, [campaign.id]: 'IMAGE' }))
                              }
                            />
                            Images
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`test-format-${campaign.id}`}
                              checked={testFormat[campaign.id] === 'VIDEO'}
                              onChange={() =>
                                setTestFormat((prev) => ({ ...prev, [campaign.id]: 'VIDEO' }))
                              }
                            />
                            Videos
                          </label>
                          <p className="field-hint">
                            Every ad in the test shares one format, so any difference in results
                            comes from the message, not the format. A video test can reuse one
                            video across all its ads with different copy.
                          </p>
                        </fieldset>
                      )}
                    {!strategy && strategyControls}
                      </>
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
                    ) : strategy.planType === 'CREATIVE_TEST_PLAN' ? (
                      <>
                        <p>
                          <strong>Creative test</strong> — this business has no
                          meaningful advertising history yet. One broad ad set
                          runs {strategy.creativeAngles.length} creative angles
                          against each other to find which earns the cheapest{' '}
                          {strategy.optimizationEvent === 'ADD_TO_CART'
                            ? 'add-to-cart'
                            : 'purchase'}
                          .
                        </p>
                        <p>
                          <strong>Audience:</strong> broad (Meta Advantage+),{' '}
                          {strategy.audienceConstraints.country}, age{' '}
                          {strategy.audienceConstraints.ageMin}+,{' '}
                          {strategy.audienceConstraints.languages.join(', ')}
                        </p>
                        <p>
                          <strong>Creative persona:</strong>{' '}
                          {strategy.creativePersona.name} —{' '}
                          {strategy.creativePersona.description}
                        </p>
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
                          <strong>Test budget:</strong> ${strategy.dailyBudget}/day on one
                          ad set for {strategy.durationDays} days (${strategy.totalBudget}{' '}
                          total)
                        </p>
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
                    {isPublished && <p className="field-hint">{ADS_LOCKED_NOTE}</p>}
                    {creativeError && (
                      <p className="form-error" role="alert">
                        {creativeError}
                      </p>
                    )}
                    {campaignCreatives.length > 0 &&
                      (selectedCreative && !showAllCreatives[campaign.id] && !isCreativeTest ? (
                        <div
                          className="ad-selected"
                          aria-label={`Selected ad for ${campaign.name ?? campaign.id}`}
                        >
                          <div
                            className={
                              selectedCreative.format === 'CAROUSEL'
                                ? 'ad-selected-grid ad-selected-grid-carousel'
                                : 'ad-selected-grid'
                            }
                          >
                            <div className="ad-selected-preview">
                              {selectedCreative.format === 'CAROUSEL' ? (
                                <CarouselEditor
                                  business={business}
                                  creative={selectedCreative}
                                  ctaLabel={ctaLabels[selectedCreative.cta] ?? selectedCreative.cta}
                                  busy={cardActionId === selectedCreative.id}
                                  locked={isPublished}
                                  error={cardErrors[selectedCreative.id]}
                                  onReorder={(cardIds) =>
                                    handleReorderCreativeCards(
                                      campaign.id,
                                      selectedCreative.id,
                                      cardIds,
                                    )
                                  }
                                  onRemove={(cardId) =>
                                    handleRemoveCreativeCard(
                                      campaign.id,
                                      selectedCreative.id,
                                      cardId,
                                    )
                                  }
                                />
                              ) : (
                                <SocialPostPreview
                                  business={business}
                                  creative={selectedCreative}
                                  ctaLabel={ctaLabels[selectedCreative.cta] ?? selectedCreative.cta}
                                />
                              )}
                            </div>
                            <div className="ad-selected-actions">
                            <button type="button" className="selected-chip" disabled>
                              Selected
                            </button>
                          {selectedCreative.format === 'CAROUSEL' ? null
                          : selectedCreative.format === 'SINGLE_VIDEO' ? (
                            // The same picker as the full ads list: this ad's video
                            // only, with the option to upload a new one. Locked once
                            // the campaign is published, like every other edit.
                            isPublished ? (
                              <ActionRow primary disabled icon={<VideoIcon />} onClick={() => {}}>
                                Change video
                              </ActionRow>
                            ) : (
                            <CreativeEditor
                              businessId={businessId}
                              campaignId={campaign.id}
                              productId={campaignProductId ?? null}
                              creative={selectedCreative}
                              showCopyControls={false}
                              rowStyle
                              onUpdated={(updated) => {
                                setCreatives((prev) => ({
                                  ...prev,
                                  [campaign.id]: (prev[campaign.id] ?? []).map((x) =>
                                    x.id === updated.id ? updated : x,
                                  ),
                                }))
                                void refresh()
                              }}
                            />
                            )
                          ) : (
                            campaignProductId && (
                            <div className="image-picker">
                              <ActionRow
                                primary
                                icon={<ImageIcon />}
                                disabled={isPublished}
                                onClick={() => handleToggleImageMenu(selectedCreative.id)}
                              >
                                {selectedCreative.imageUrl ? 'Change image' : 'Upload Image'}
                              </ActionRow>
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
                                  <p className="field-hint">{PHOTOS_ONLY_HINT}</p>
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
                            )
                          )}
                          {selectedCreative.format === 'SINGLE_IMAGE' &&
                            campaignProductId && (
                              <>
                                {(['story', 'square'] as const).map((slot) => (
                                  <ExtraAssetSlot
                                    key={slot}
                                    slot={slot}
                                    businessId={businessId}
                                    campaignId={campaign.id}
                                    productId={campaignProductId}
                                    creative={selectedCreative}
                                    locked={isPublished}
                                    onUpdated={(updated) => {
                                      setCreatives((prev) => ({
                                        ...prev,
                                        [campaign.id]: (prev[campaign.id] ?? []).map((x) =>
                                          x.id === updated.id ? updated : x,
                                        ),
                                      }))
                                      void refresh()
                                    }}
                                  />
                                ))}
                              </>
                            )}
                          <div className="card-divider" />
                          <p className="card-tags-label">Tags</p>
                          <ul className="card-tags" aria-label="Tags">
                            {[
                              business?.industry
                                ? (options?.industries.find((o) => o.value === business.industry)
                                    ?.label ?? business.industry)
                                : null,
                              brandPricePositioning
                                ? (options?.pricePositionings.find(
                                    (o) => o.value === brandPricePositioning,
                                  )?.label ?? brandPricePositioning)
                                : null,
                              FORMAT_TAG_LABELS[selectedCreative.format] ?? null,
                            ]
                              .filter((tag): tag is string => tag !== null)
                              .map((tag) => (
                                <li key={tag} className="card-tag">
                                  {tag}
                                </li>
                              ))}
                          </ul>
                            </div>
                          </div>
                          {!isPublished && (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() =>
                                setShowAllCreatives((prev) => ({ ...prev, [campaign.id]: true }))
                              }
                            >
                              Choose a different ad
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                        {isCreativeTest && (
                          <div>
                            <p>
                              {testAdCount} of {MIN_TEST_ADS}–{MAX_TEST_ADS} ads selected
                            </p>
                            <p>
                              These ads run together in one ad set, so the test shows which
                              angle earns the cheapest result.
                            </p>
                          </div>
                        )}
                        <section
                          className="creative-choices"
                          aria-labelledby={`creative-choices-${campaign.id}`}
                        >
                          <h4 id={`creative-choices-${campaign.id}`}>
                            {isCreativeTest ? 'Choose your test ads' : 'Choose your ad creative'}
                          </h4>
                          {!isCreativeTest && (
                            <p className="creative-choices-intro">
                              Review your generated creative options, then continue with one to
                              preview your{' '}
                              {campaignCreatives.every((c) => c.format === 'CAROUSEL')
                                ? 'carousel '
                                : ''}
                              campaign.
                            </p>
                          )}
                        <ul
                          className="creative-card-list"
                          aria-label={`Ad creatives for ${campaign.name ?? campaign.id}`}
                        >
                          {campaignCreatives.map((c, index) => (
                            <li key={c.id}>
                              <CreativeCard
                                letter={VARIANT_LETTERS[index] ?? String(index + 1)}
                                creative={c}
                                ctaLabel={ctaLabels[c.cta] ?? c.cta}
                                action={
                                  isPublished ? undefined : isCreativeTest ? (
                                    (c.status === 'SELECTED' || testAdCount < MAX_TEST_ADS) && (
                                      <button
                                        type="button"
                                        className="btn-outline creative-card-button"
                                        onClick={() =>
                                          handleToggleTestAd(
                                            campaign.id,
                                            c.id,
                                            c.status === 'SELECTED',
                                          )
                                        }
                                        disabled={selectingId === c.id}
                                      >
                                        {selectingId === c.id
                                          ? 'Updating…'
                                          : c.status === 'SELECTED'
                                            ? 'Remove from test'
                                            : 'Add to test'}
                                      </button>
                                    )
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn-outline btn-gold creative-card-button"
                                      aria-busy={selectingId === c.id}
                                      disabled={selectingId === c.id}
                                      onClick={() =>
                                        // The chosen ad is already saved as selected when
                                        // coming back from the preview: just go on to it.
                                        c.status === 'SELECTED'
                                          ? navigate(
                                              `/businesses/${businessId}/campaigns/${campaign.id}/ad`,
                                            )
                                          : void handleSelectCreative(campaign.id, c.id)
                                      }
                                    >
                                      {selectingId === c.id
                                        ? 'Opening preview…'
                                        : 'Continue with this creative'}
                                      {selectingId !== c.id && <ArrowRightIcon />}
                                    </button>
                                  )
                                }
                              >
                                {c.format !== 'CAROUSEL' && !isPublished && (
                                  <CreativeEditor
                                    businessId={businessId}
                                    campaignId={campaign.id}
                                    productId={campaignProductId ?? null}
                                    creative={c}
                                    onUpdated={(updated) => {
                                      setCreatives((prev) => ({
                                        ...prev,
                                        [campaign.id]: (prev[campaign.id] ?? []).map((x) =>
                                          x.id === updated.id ? updated : x,
                                        ),
                                      }))
                                      // An approved campaign drops back to
                                      // PENDING_APPROVAL when a selected ad changes.
                                      void refresh()
                                    }}
                                  />
                                )}
                              </CreativeCard>
                            </li>
                          ))}
                        </ul>
                        {!isPublished && (isCreativeTest || selectedCreative) && (
                          <div className="creative-next">
                            {isCreativeTest && testAdCount < MIN_TEST_ADS && (
                              <p id={`creative-next-hint-${campaign.id}`} className="field-hint">
                                Select at least {MIN_TEST_ADS} ads to continue.
                              </p>
                            )}
                            <button
                              type="button"
                              className="btn-next"
                              disabled={isCreativeTest && testAdCount < MIN_TEST_ADS}
                              aria-describedby={
                                isCreativeTest && testAdCount < MIN_TEST_ADS
                                  ? `creative-next-hint-${campaign.id}`
                                  : undefined
                              }
                              onClick={() =>
                                navigate(`/businesses/${businessId}/campaigns/${campaign.id}/ad`)
                              }
                            >
                              Next
                              <ArrowRightIcon />
                            </button>
                          </div>
                        )}
                        </section>
                        </>
                      ))}
                  </div>
                )}
                <div className="card-editing">
                {hasStaleCreatives && !isPublished && (
                  <div
                    className="campaign-block card-notice"
                    aria-label={`Stale ads for ${campaign.name ?? campaign.id}`}
                  >
                    <p role="alert">
                      These ads were generated from an older version of the product. Regenerate?
                    </p>
                    <button
                      type="button"
                      className="button-quiet"
                      onClick={() => void handleGenerateCreatives(campaign.id)}
                      disabled={generatingCreativesId === campaign.id}
                    >
                      {generatingCreativesId === campaign.id ? 'Regenerating…' : 'Regenerate'}
                    </button>
                  </div>
                )}
                  {(formatPicker !== null || editingActions.length > 0) && (
                    <div className="card-editing-row">
                      {strategy && formatPicker}
                      <CardToolbar label="Edit campaign" actions={editingActions} />
                    </div>
                  )}
                  {strategy && formatHints}
                  {strategy && strategyControls}
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
                            // A freshly created product isn't in this
                            // section's own products list yet — without
                            // this, the campaign's thumbnail (looked up
                            // from that list) would silently stay blank
                            // until the next full reload, even though
                            // the campaign's own productId updates right
                            // away via handleAttachToCampaign below.
                            setProducts((prev) => [...prev, created])
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
                {isDraft && (
                  <div className="campaign-card-footer">
                    {nextSetupStep && (
                      <button
                        type="button"
                        className="campaign-card-continue"
                        onClick={nextSetupStep.onAction}
                      >
                        Continue setup
                        <ArrowRightIcon />
                      </button>
                    )}
                    {removeAction}
                  </div>
                )}
                {canPublish && (
                  <PublishFooter
                    ariaLabel={`Publish ${campaign.name ?? campaign.id}`}
                    heading={
                      campaign.status === 'FAILED'
                        ? 'Publishing failed'
                        : isPublishing
                          ? 'Publishing to Meta…'
                          : 'Ready to publish?'
                    }
                    description={
                      campaign.status === 'FAILED'
                        ? 'The last attempt did not go through. You can retry now.'
                        : pausedChoice
                          ? 'Approving sends this campaign to Meta paused. It will not run or spend until you click Activate.'
                          : 'Approving sends this campaign to Meta set to run. It can start spending as soon as Meta approves it.'
                    }
                    pausedId={`publish-paused-${campaign.id}`}
                    paused={pausedChoice}
                    onPausedChange={(checked) => {
                      setPublishPausedState((prev) => ({ ...prev, [campaign.id]: checked }))
                      setPublishPaused(campaign.id, checked)
                    }}
                    buttonLabel={
                      campaign.id in publishStatuses
                        ? describePublishStatus(publishStatuses[campaign.id])
                        : approvingId === campaign.id
                          ? 'Publishing…'
                          : campaign.status === 'FAILED'
                            ? 'Retry publish'
                            : 'Approve & Publish'
                    }
                    buttonDisabled={isPublishing}
                    onPublish={() => handleApproveAndPublish(campaign.id, campaign.status)}
                    error={approveError}
                  >
                    <InstagramNote businessId={businessId} />
                  </PublishFooter>
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
                    {campaign.pixelWarning && (
                      <p role="alert">⚠ {campaign.pixelWarning}</p>
                    )}
                    {campaign.dailySpendFlag && (
                      <p role="alert">⚠ {campaign.dailySpendFlag}</p>
                    )}
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => handlePause(campaign.id)}
                      disabled={pausingId === campaign.id}
                    >
                      <PauseIcon />
                      {pausingId === campaign.id ? 'Pausing…' : 'Pause campaign'}
                    </button>
                    {pauseError && (
                      <p className="form-error" role="alert">
                        {pauseError}
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => handleRefreshMetrics(campaign.id)}
                      disabled={refreshingMetricsId === campaign.id}
                    >
                      <RefreshIcon size={18} />
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
                      className="btn-outline"
                      onClick={() => handleAnalyze(campaign.id)}
                      disabled={analyzingId === campaign.id}
                    >
                      <RefreshIcon size={18} />
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
                              {recommendation.suggestedBid != null && (
                                <p>
                                  <strong>Suggested cost cap:</strong> $
                                  {recommendation.suggestedBid.toFixed(2)} per result
                                </p>
                              )}
                              {recommendation.status === 'PENDING' && (
                                <div className="button-row">
                                  <button
                                    type="button"
                                    className="btn-outline btn-gold"
                                    onClick={() =>
                                      handleApproveRecommendation(campaign.id, recommendation.id)
                                    }
                                    disabled={acting}
                                  >
                                    <CheckIcon />
                                    {approving ? 'Approving…' : 'Approve'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-outline btn-outline-danger"
                                    onClick={() =>
                                      handleRejectRecommendation(campaign.id, recommendation.id)
                                    }
                                    disabled={acting}
                                  >
                                    <CloseIcon />
                                    {rejecting ? 'Rejecting…' : 'Reject'}
                                  </button>
                                </div>
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
                          className="btn-outline"
                          onClick={() => handleEvaluateTestPlan(campaign.id)}
                          disabled={evaluatingId === campaign.id}
                        >
                          <CheckIcon />
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
                  <div
                    className="campaign-block"
                    aria-label={`Paused status for ${campaign.name ?? campaign.id}`}
                  >
                    <p>
                      {isActivatable
                        ? 'Paused — activate in Sales Guru or Ads Manager'
                        : `Paused${campaign.pausedReason ? ` — ${campaign.pausedReason}` : ''}`}
                    </p>
                    {isActivatable && (
                      <>
                        <button
                          type="button"
                          className="btn-outline btn-gold"
                          onClick={() => handleActivate(campaign.id)}
                          disabled={activatingId === campaign.id}
                        >
                          <PlayIcon />
                          {activatingId === campaign.id ? 'Activating…' : 'Activate'}
                        </button>
                        {activateError && (
                          <p className="form-error" role="alert">
                            {activateError}
                          </p>
                        )}
                      </>
                    )}
                  </div>
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
            <button type="submit" className="btn-outline btn-gold" disabled={submitting}>
              <PlusIcon />
              {submitting ? 'Creating…' : 'Create campaign'}
            </button>
          </form>
        </section>
      )}
    </>
  )
}
