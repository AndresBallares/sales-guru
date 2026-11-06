import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  estimateResearchRun,
  listProducts,
  startResearchRun,
  type Product,
  type ResearchDepth,
  type ResearchEstimate,
  type ResearchModel,
  type ResearchRun,
} from '../lib/api'
import {
  MAX_RESEARCH_COMPETITOR_URLS,
  MAX_RESEARCH_PRODUCTS,
  RESEARCH_DEPTHS,
  RESEARCH_MODELS,
  formatUsd,
  readinessAdvice,
} from '../lib/research'
import { isValidDestinationUrl, normalizeDestinationUrl } from '../lib/urlValidation'
import { ResearchChoiceCard } from './ResearchChoiceCard'
import { ResearchConfigurationSummary } from './ResearchConfigurationSummary'
import { ResearchProductCard } from './ResearchProductCard'
import { BoltIcon, MicroscopeIcon, SearchIcon } from './icons'

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

const ESTIMATE_DELAY_MS = 250

type EstimateResult = { estimate: ResearchEstimate } | { error: string }

// Start a research run: depth, model, products, extra competitors, what is missing, and
// what it will cost. Nothing is spent until "Start Research".
export function ResearchStart({
  businessId,
  activeRunId,
  onStarted,
  onBack,
  onViewRun,
}: {
  businessId: string
  // A run that is queued or running now; only one may run at a time.
  activeRunId: string | null
  onStarted: (run: ResearchRun) => void
  onBack: () => void
  onViewRun: (runId: string) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [products, setProducts] = useState<Product[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [depth, setDepth] = useState<ResearchDepth>('standard')
  const [model, setModel] = useState<ResearchModel>('claude-opus-5-5')
  const [urlText, setUrlText] = useState('')
  // The server's estimate for each depth, for the model and products chosen: asked for all
  // three at once, so the cards can show what each depth is expected to cost and a change of
  // depth needs no new request.
  const [estimates, setEstimates] = useState<Partial<Record<ResearchDepth, EstimateResult>>>({})
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // Set at once on a click, before React re-renders, so a double click sends one request.
  const busyRef = useRef(false)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    listProducts(businessId)
      .then((list) => {
        if (cancelled) return
        setProducts(list)
        setChosen(list.slice(0, MAX_RESEARCH_PRODUCTS).map((p) => p.id))
      })
      .catch(() => {
        if (!cancelled) setProducts([])
      })
    return () => {
      cancelled = true
    }
  }, [businessId])

  const urlLines = useMemo(
    () =>
      urlText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    [urlText],
  )
  const badUrls = urlLines.filter((line) => !isValidDestinationUrl(line))
  const tooManyUrls = urlLines.length > MAX_RESEARCH_COMPETITOR_URLS
  const urlsOk = badUrls.length === 0 && !tooManyUrls
  const competitorUrls = urlsOk ? urlLines.map(normalizeDestinationUrl) : []
  const productIds = (products ?? []).filter((p) => chosen.includes(p.id)).map((p) => p.id)

  const inputKey = JSON.stringify([model, productIds, competitorUrls])
  useEffect(() => {
    if (products === null || !urlsOk) return
    let cancelled = false
    const timer = setTimeout(() => {
      Promise.all(
        RESEARCH_DEPTHS.map(({ value }) =>
          estimateResearchRun(businessId, {
            depth: value,
            model,
            productIds: productIds.length > 0 ? productIds : undefined,
            competitorUrls,
          }).then(
            (estimate): [ResearchDepth, EstimateResult] => [value, { estimate }],
            (e: unknown): [ResearchDepth, EstimateResult] => [
              value,
              { error: message(e, 'Could not work out the cost') },
            ],
          ),
        ),
      ).then((entries) => {
        if (!cancelled) setEstimates(Object.fromEntries(entries))
      })
    }, ESTIMATE_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // inputKey carries every input the request is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, products, urlsOk, inputKey])

  const chosenResult = estimates[depth]
  const estimate = chosenResult !== undefined && 'estimate' in chosenResult ? chosenResult.estimate : null
  const estimateError = chosenResult !== undefined && 'error' in chosenResult ? chosenResult.error : null

  function toggleProduct(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    )
  }

  const emptyItems = (estimate?.readiness ?? []).filter((item) => item.empty)
  const noRunsLeft = estimate !== null && estimate.runsRemaining <= 0
  const running = activeRunId !== null
  const canStart = estimate !== null && urlsOk && !noRunsLeft && !running && !starting
  const allowed = estimate?.allowedModels ?? []

  async function start() {
    if (busyRef.current) return
    busyRef.current = true
    setStarting(true)
    setStartError(null)
    try {
      const run = await startResearchRun(businessId, {
        depth,
        model,
        productIds: productIds.length > 0 ? productIds : undefined,
        competitorUrls,
      })
      onStarted(run)
    } catch (e) {
      setStartError(message(e, 'Could not start the research'))
      setStarting(false)
      busyRef.current = false
    }
  }

  const depthOption = RESEARCH_DEPTHS.find((d) => d.value === depth) ?? RESEARCH_DEPTHS[1]
  const modelOption = RESEARCH_MODELS.find((m) => m.value === model) ?? RESEARCH_MODELS[0]
  const chosenProducts = (products ?? []).filter((p) => chosen.includes(p.id))
  const atLimit = chosen.length >= MAX_RESEARCH_PRODUCTS
  const costOf = (result: EstimateResult | undefined) =>
    result !== undefined && 'estimate' in result ? formatUsd(result.estimate.expectedUsd) : undefined
  const depthIcons = { light: <BoltIcon />, standard: <SearchIcon />, deep: <MicroscopeIcon /> }

  return (
    <section className="research-start" aria-labelledby="research-start-heading">
      <h2 id="research-start-heading" ref={headingRef} tabIndex={-1}>
        Research Avatars
      </h2>
      <p className="field-hint research-intro">
        Discover what your customers think, what motivates their decisions, and how your
        competitors position themselves. Sales Guru researches your market and develops buyer
        avatars for you to review. Nothing is saved to your library until you choose.
      </p>

      {running && (
        <div className="flow-callout">
          <p>
            <strong>A research run is already running.</strong> Only one can run at a time.
          </p>
          <button type="button" className="btn-outline" onClick={() => onViewRun(activeRunId)}>
            View progress
          </button>
        </div>
      )}

      <div className="research-layout">
        <div className="research-config">
          <fieldset className="research-section">
            <legend>
              <span className="research-step">1.</span> Research depth
            </legend>
            <p className="field-hint">
              Choose how extensively Sales Guru should investigate your market and customer
              behavior.
            </p>
            <div className="choice-grid choice-grid-three">
              {RESEARCH_DEPTHS.map((option) => (
                <ResearchChoiceCard
                  key={option.value}
                  name="research-depth"
                  value={option.value}
                  checked={depth === option.value}
                  icon={depthIcons[option.value]}
                  title={option.label}
                  tag={option.tag}
                  description={option.description}
                  cost={costOf(estimates[option.value])}
                  onSelect={() => setDepth(option.value)}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="research-section">
            <legend>
              <span className="research-step">2.</span> AI research model
            </legend>
            <p className="field-hint">
              Choose the AI model that will analyze your market and develop customer insights.
            </p>
            <div className="choice-grid choice-grid-two">
              {RESEARCH_MODELS.map((option) => {
                // Until the first estimate says which models are allowed, only the default is.
                const available =
                  allowed.length === 0
                    ? option.value === 'claude-opus-5-5'
                    : allowed.includes(option.value)
                return (
                  <ResearchChoiceCard
                    key={option.value}
                    name="research-model"
                    value={option.value}
                    checked={model === option.value}
                    disabled={!available}
                    icon={<SearchIcon />}
                    title={option.label}
                    tag={option.status}
                    description={option.description}
                    note={available ? undefined : option.unavailableNote}
                    onSelect={() => setModel(option.value)}
                  />
                )
              })}
            </div>
          </fieldset>

          <fieldset className="research-section">
            <legend>
              <span className="research-step">3.</span> Products to research
            </legend>
            <p className="field-hint">
              Select up to three products for Sales Guru to investigate. We'll use these products
              to understand your target customers, their motivations, and their purchasing
              behavior.
            </p>
            {products === null && <p>Loading products…</p>}
            {products !== null && products.length === 0 && (
              <p>
                You have no products yet. Add one in the <a href="#products">Products tab</a>.
              </p>
            )}
            <output className="research-counter">
              {chosen.length} of {MAX_RESEARCH_PRODUCTS} selected
            </output>
            {atLimit && (
              <p className="research-limit-note">
                You've selected the maximum of three products. Remove a selection to choose
                another product.
              </p>
            )}
            <div className="product-choice-grid">
              {(products ?? []).map((product) => {
                const checked = chosen.includes(product.id)
                return (
                  <ResearchProductCard
                    key={product.id}
                    product={product}
                    checked={checked}
                    disabled={!checked && atLimit}
                    onToggle={() => toggleProduct(product.id)}
                  />
                )
              })}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="research-competitors">
              Extra competitor web addresses (optional, one per line, at most{' '}
              {MAX_RESEARCH_COMPETITOR_URLS})
            </label>
            <textarea
              id="research-competitors"
              rows={3}
              value={urlText}
              aria-invalid={!urlsOk}
              aria-describedby={urlsOk ? undefined : 'research-competitors-error'}
              onChange={(event) => setUrlText(event.target.value)}
            />
            {!urlsOk && (
              <p id="research-competitors-error" className="form-error">
                {badUrls.length > 0
                  ? `"${badUrls[0]}" is not a full web address, e.g. https://rival.com`
                  : `At most ${MAX_RESEARCH_COMPETITOR_URLS} extra competitor addresses.`}
              </p>
            )}
          </div>

          <section className="research-ready" aria-labelledby="research-ready-heading">
            <h3 id="research-ready-heading">Before you start</h3>
            {estimate === null ? (
              <p>Checking what the research has to work with…</p>
            ) : emptyItems.length === 0 ? (
              <p>Everything the research reads is filled in.</p>
            ) : (
              <>
                <p>
                  These are empty. The research still runs without them, but its results will be
                  less specific.
                </p>
                <ul>
                  {emptyItems.map((item) => {
                    const advice = readinessAdvice(item.field)
                    return (
                      <li key={item.field}>
                        <strong>{item.label}</strong>
                        <span> — {advice.why} </span>
                        {advice.where === 'brand' ? (
                          <Link to="/">Fill it in on your brand profile</Link>
                        ) : (
                          <a href="#products">Fill it in in the Products tab</a>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>
        </div>

        <ResearchConfigurationSummary
          depth={depthOption}
          model={modelOption}
          products={chosenProducts}
        >
          <div className="research-cost">
            <h4>Cost</h4>
            {estimate !== null && (
              <>
                <p>
                  Expected: about {formatUsd(estimate.expectedUsd)}; at most{' '}
                  {formatUsd(estimate.maxUsd)}. Up to {estimate.maxSearches} searches and{' '}
                  {estimate.maxFetches} page reads.
                </p>
                <p>
                  {Math.max(estimate.runsRemaining, 0)} of {estimate.runsPerMonth} research runs
                  left this month.
                </p>
                {noRunsLeft && (
                  <p className="form-error">
                    You have used all of this month's research runs. They reset at the start of
                    next month.
                  </p>
                )}
              </>
            )}
            {estimate === null && !estimateError && <p>Working out the cost…</p>}
          </div>

          {(estimateError || startError) && (
            <p className="form-error" role="alert">
              {startError ?? estimateError}
            </p>
          )}

          <div className="research-summary-actions">
            <button
              type="button"
              className="btn-outline btn-gold"
              disabled={!canStart}
              onClick={() => void start()}
            >
              {starting
                ? 'Starting research…'
                : emptyItems.length > 0
                  ? 'Research anyway →'
                  : 'Start Research →'}
            </button>
            <button type="button" className="btn-outline" onClick={onBack}>
              Back to avatars
            </button>
          </div>
        </ResearchConfigurationSummary>
      </div>
    </section>
  )
}
