import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  approveCampaign,
  approveRecommendation,
  createCampaign,
  createCreatives,
  createRecommendation,
  createStrategy,
  createTestEvaluation,
  EVENT_VENUES,
  getStrategy,
  listAudiences,
  listCampaigns,
  listCreatives,
  listMetrics,
  listProducts,
  listRecommendations,
  listTestEvaluations,
  pauseCampaign,
  publishCampaign,
  refreshMetrics,
  rejectRecommendation,
  selectCreative,
  type ActionType,
  type Audience,
  type Campaign,
  type Creative,
  type Metric,
  type Objective,
  type Product,
  type Recommendation,
  type StrategyContent,
  type TargetLocation,
  type TestEvaluation,
} from '../lib/api'

function formatLocations(locations: TargetLocation[]): string {
  return locations
    .map((loc) => [loc.city, loc.region].filter(Boolean).join(', '))
    .join('; ')
}

const OBJECTIVE_LABELS: Record<Objective, string> = {
  SALES: 'Sales',
  LEADS: 'Leads',
  TRAFFIC: 'Traffic',
  MESSAGES: 'Messages',
  AWARENESS: 'Awareness',
}

const ACTION_LABELS: Record<ActionType, string> = {
  PAUSE_AD: 'Pause ad',
  INCREASE_BUDGET: 'Increase budget',
  DECREASE_BUDGET: 'Decrease budget',
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
  const [eventVenueKey, setEventVenueKey] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
        eventVenueKey: eventVenueKey || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      })
      setName('')
      setObjective('SALES')
      setProductId('')
      setAudienceId('')
      setEventVenueKey('')
      setStartDate('')
      setEndDate('')
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create campaign.')
    } finally {
      setSubmitting(false)
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
            return (
              <li key={campaign.id}>
                {campaign.name ? `${campaign.name} — ` : ''}
                {OBJECTIVE_LABELS[campaign.objective]} — {campaign.status}
                {campaign.eventVenueKey && (
                  <p>
                    Event:{' '}
                    {EVENT_VENUES.find((v) => v.key === campaign.eventVenueKey)?.label ??
                      campaign.eventVenueKey}
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
                  </fieldset>
                )}
                {strategy && (
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
                  <div>
                    <p>
                      Live on Meta
                      {campaign.metaCampaignId ? ` (id: ${campaign.metaCampaignId})` : ''}
                    </p>
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
                                <strong>{ACTION_LABELS[recommendation.actionType]}</strong>
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
          <div className="field">
            <label htmlFor="event-venue">Event venue</label>
            <select
              id="event-venue"
              value={eventVenueKey}
              onChange={(event) => setEventVenueKey(event.target.value)}
            >
              <option value="">None — broad US targeting</option>
              {EVENT_VENUES.map((venue) => (
                <option key={venue.key} value={venue.key}>
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
    </>
  )
}
