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
import { productLabel } from '../lib/productLabel'

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

const ESTIMATE_DELAY_MS = 250

// Start a research run: depth, model, products, extra competitors, what is missing, and
// what it will cost. Nothing is spent until "Start research".
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
  const [estimate, setEstimate] = useState<ResearchEstimate | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

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

  const inputKey = JSON.stringify([depth, model, productIds, competitorUrls])
  useEffect(() => {
    if (products === null || !urlsOk) return
    let cancelled = false
    const timer = setTimeout(() => {
      estimateResearchRun(businessId, {
        depth,
        model,
        productIds: productIds.length > 0 ? productIds : undefined,
        competitorUrls,
      })
        .then((result) => {
          if (cancelled) return
          setEstimate(result)
          setEstimateError(null)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setEstimate(null)
          setEstimateError(message(e, 'Could not work out the cost'))
        })
    }, ESTIMATE_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // inputKey carries every input the request is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, products, urlsOk, inputKey])

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
    }
  }

  return (
    <section className="research-start" aria-labelledby="research-start-heading">
      <h2 id="research-start-heading" ref={headingRef} tabIndex={-1}>
        Research avatars
      </h2>
      <p className="field-hint">
        The AI reads your site and your competitors, looks for what customers say, and drafts
        problems, solutions and buyer avatars for you to review. Nothing is saved to your
        library until you choose.
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

      <fieldset className="research-group">
        <legend>Depth</legend>
        {RESEARCH_DEPTHS.map((option) => (
          <div key={option.value} className="research-choice">
            <input
              type="radio"
              name="research-depth"
              id={`research-depth-${option.value}`}
              checked={depth === option.value}
              onChange={() => setDepth(option.value)}
            />
            <label htmlFor={`research-depth-${option.value}`}>
              {option.label}
              <span className="field-hint"> {option.meaning}</span>
            </label>
          </div>
        ))}
      </fieldset>

      <fieldset className="research-group">
        <legend>Model</legend>
        {RESEARCH_MODELS.map((option) => {
          // Until the first estimate says which models are allowed, only the default is.
          const available =
            allowed.length === 0 ? option.value === 'claude-opus-5-5' : allowed.includes(option.value)
          return (
            <div key={option.value} className="research-choice">
              <input
                type="radio"
                name="research-model"
                id={`research-model-${option.value}`}
                checked={model === option.value}
                disabled={!available}
                aria-describedby={`research-model-note-${option.value}`}
                onChange={() => setModel(option.value)}
              />
              <label htmlFor={`research-model-${option.value}`}>{option.label}</label>
              <span id={`research-model-note-${option.value}`} className="field-hint">
                {' '}
                {available ? option.note : option.unavailableNote}
              </span>
            </div>
          )
        })}
      </fieldset>

      <fieldset className="research-group">
        <legend>Products to research</legend>
        {products === null && <p>Loading products…</p>}
        {products !== null && products.length === 0 && (
          <p>
            You have no products yet. Add one in the <a href="#products">Products tab</a>.
          </p>
        )}
        <p className="field-hint">Up to {MAX_RESEARCH_PRODUCTS}. The first three are chosen for you.</p>
        {(products ?? []).map((product) => {
          const checked = chosen.includes(product.id)
          const full = !checked && chosen.length >= MAX_RESEARCH_PRODUCTS
          return (
            <div key={product.id} className="research-choice">
              <input
                type="checkbox"
                id={`research-product-${product.id}`}
                checked={checked}
                disabled={full}
                onChange={() => toggleProduct(product.id)}
              />
              <label htmlFor={`research-product-${product.id}`}>{productLabel(product)}</label>
            </div>
          )
        })}
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
              These are empty. The research still runs without them, but its results will be less
              specific.
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

      <section className="research-cost" aria-labelledby="research-cost-heading">
        <h3 id="research-cost-heading">Cost</h3>
        {estimate !== null && (
          <>
            <p>
              Expected: about {formatUsd(estimate.expectedUsd)}; at most {formatUsd(estimate.maxUsd)}.
              Up to {estimate.maxSearches} searches and {estimate.maxFetches} page reads.
            </p>
            <p>
              {Math.max(estimate.runsRemaining, 0)} of {estimate.runsPerMonth} research runs left
              this month.
            </p>
            {noRunsLeft && (
              <p className="form-error">
                You have used all of this month's research runs. They reset at the start of next
                month.
              </p>
            )}
          </>
        )}
        {estimate === null && !estimateError && <p>Working out the cost…</p>}
      </section>

      {(estimateError || startError) && (
        <p className="form-error" role="alert">
          {startError ?? estimateError}
        </p>
      )}

      <div className="avatar-actions">
        <button
          type="button"
          className="btn-outline btn-gold"
          disabled={!canStart}
          onClick={() => void start()}
        >
          {emptyItems.length > 0 ? 'Research anyway' : 'Start research'}
        </button>
        <button type="button" className="btn-outline" onClick={onBack}>
          Back to avatars
        </button>
      </div>
    </section>
  )
}
