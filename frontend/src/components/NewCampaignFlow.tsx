import { useState, type FormEvent } from 'react'
import {
  ApiError,
  createCampaign,
  createStrategy,
  updateCampaign,
  type Audience,
  type Campaign,
  type Objective,
  type Option,
  type Product,
} from '../lib/api'
import { requiresDestinationUrl } from '../lib/urlValidation'
import { AudienceForm } from './AudienceForm'
import { ProductForm } from './ProductForm'

type Step = 'details' | 'product' | 'audience' | 'strategy'

// A second+ campaign used to drop the user into a "pick from your
// library" flow by default (a bare picker + a buried "Add new product"
// button) — the wrong default, since a business typically promotes a
// *different* product each campaign (confirmed 2026-09-09: a jewelry
// business running a necklace campaign, then an earrings one, needs
// distinct AI inputs each time, not its existing library re-shown to it).
// This walks name/objective → a full ProductForm → a full AudienceForm →
// strategy generation, the same components and sequence as first-time
// onboarding (ProductsSection/AudiencesSection), continuously — the
// campaigns list is never shown in between. Reusing an existing product/
// audience is still possible, just a secondary "Use an existing ... "
// link on each step, hidden entirely when there's nothing to reuse.
export function NewCampaignFlow({
  businessId,
  products,
  audiences,
  objectiveOptions,
  eventVenueOptions,
  onCancel,
  onDone,
}: {
  businessId: string
  products: Product[]
  audiences: Audience[]
  objectiveOptions: Option[]
  eventVenueOptions: Option[]
  onCancel: () => void
  onDone: () => void
}) {
  const [step, setStep] = useState<Step>('details')
  const [campaign, setCampaign] = useState<Campaign | null>(null)

  const [name, setName] = useState('')
  const [objective, setObjective] = useState<Objective>('SALES')
  const [eventVenueKey, setEventVenueKey] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [submittingDetails, setSubmittingDetails] = useState(false)

  const [reuseProduct, setReuseProduct] = useState(false)
  const [pickedProductId, setPickedProductId] = useState('')
  const [productError, setProductError] = useState<string | null>(null)
  const [attachingProduct, setAttachingProduct] = useState(false)

  const [reuseAudience, setReuseAudience] = useState(false)
  const [pickedAudienceId, setPickedAudienceId] = useState('')
  const [audienceError, setAudienceError] = useState<string | null>(null)
  const [attachingAudience, setAttachingAudience] = useState(false)

  const [generatingStrategy, setGeneratingStrategy] = useState(false)
  const [strategyError, setStrategyError] = useState<string | null>(null)
  const [needsAdExperienceAnswer, setNeedsAdExperienceAnswer] = useState(false)

  const urlRequired = requiresDestinationUrl(objective)

  async function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDetailsError(null)
    setSubmittingDetails(true)
    try {
      const created = await createCampaign(businessId, {
        objective,
        name: name || undefined,
        eventVenueKey: eventVenueKey || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      })
      setCampaign(created)
      setStep('product')
    } catch (err) {
      setDetailsError(err instanceof ApiError ? err.message : 'Could not create campaign.')
    } finally {
      setSubmittingDetails(false)
    }
  }

  async function attachProduct(productId: string) {
    if (!campaign || !productId) return
    setAttachingProduct(true)
    setProductError(null)
    try {
      const updated = await updateCampaign(businessId, campaign.id, { productId })
      setCampaign(updated)
      setStep('audience')
    } catch (err) {
      setProductError(err instanceof ApiError ? err.message : 'Could not attach product.')
    } finally {
      setAttachingProduct(false)
    }
  }

  async function attachAudience(audienceId: string) {
    if (!campaign || !audienceId) return
    setAttachingAudience(true)
    setAudienceError(null)
    try {
      const updated = await updateCampaign(businessId, campaign.id, { audienceId })
      setCampaign(updated)
      setStep('strategy')
    } catch (err) {
      setAudienceError(err instanceof ApiError ? err.message : 'Could not attach audience.')
    } finally {
      setAttachingAudience(false)
    }
  }

  async function handleGenerateStrategy(hasPriorAdvertisingExperience?: boolean) {
    if (!campaign) return
    setGeneratingStrategy(true)
    setStrategyError(null)
    try {
      await createStrategy(businessId, campaign.id, hasPriorAdvertisingExperience)
      setNeedsAdExperienceAnswer(false)
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 428) {
        // The one-time "has this business advertised before?" question
        // hasn't been answered yet — ask, then retry with the answer.
        setNeedsAdExperienceAnswer(true)
        return
      }
      setStrategyError(err instanceof ApiError ? err.message : 'Could not generate strategy.')
    } finally {
      setGeneratingStrategy(false)
    }
  }

  return (
    <section aria-label="New campaign">
      <h2>New campaign</h2>

      {step === 'details' && (
        <form onSubmit={handleDetailsSubmit} noValidate>
          <div className="field">
            <label htmlFor="new-campaign-name">Name</label>
            <input
              id="new-campaign-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-campaign-objective">Objective</label>
            <select
              id="new-campaign-objective"
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
            <label htmlFor="new-campaign-event-venue">Event venue</label>
            <select
              id="new-campaign-event-venue"
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
                <label htmlFor="new-campaign-start-date">Start date</label>
                <input
                  id="new-campaign-start-date"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="new-campaign-end-date">End date</label>
                <input
                  id="new-campaign-end-date"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
              <p>Leave dates blank to default to the venue's typical window.</p>
            </>
          )}
          {detailsError && (
            <p className="form-error" role="alert">
              {detailsError}
            </p>
          )}
          <div className="button-row">
            <button type="submit" disabled={submittingDetails}>
              {submittingDetails ? 'Creating…' : 'Continue'}
            </button>
            <button type="button" onClick={onCancel} disabled={submittingDetails}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === 'product' && (
        <div aria-label="Add a product for this campaign">
          <h3>What are you promoting?</h3>
          {!reuseProduct ? (
            <>
              <ProductForm
                businessId={businessId}
                urlRequired={urlRequired}
                onSaved={(created) => void attachProduct(created.id)}
                onCancel={onCancel}
              />
              {products.length > 0 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setReuseProduct(true)}
                >
                  Use an existing product instead
                </button>
              )}
            </>
          ) : (
            <div className="button-row">
              <select
                aria-label="Choose an existing product"
                value={pickedProductId}
                onChange={(event) => setPickedProductId(event.target.value)}
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
                onClick={() => void attachProduct(pickedProductId)}
                disabled={!pickedProductId || attachingProduct}
              >
                {attachingProduct ? 'Attaching…' : 'Attach'}
              </button>
              <button type="button" onClick={() => setReuseProduct(false)}>
                Add a new product instead
              </button>
            </div>
          )}
          {productError && (
            <p className="form-error" role="alert">
              {productError}
            </p>
          )}
        </div>
      )}

      {step === 'audience' && (
        <div aria-label="Add an audience for this campaign">
          <h3>Who are you targeting?</h3>
          {!reuseAudience ? (
            <>
              <AudienceForm
                businessId={businessId}
                onSaved={(created) => void attachAudience(created.id)}
                onCancel={onCancel}
              />
              {audiences.length > 0 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setReuseAudience(true)}
                >
                  Use an existing audience instead
                </button>
              )}
            </>
          ) : (
            <div className="button-row">
              <select
                aria-label="Choose an existing audience"
                value={pickedAudienceId}
                onChange={(event) => setPickedAudienceId(event.target.value)}
              >
                <option value="">Choose an audience…</option>
                {audiences.map((audience) => (
                  <option key={audience.id} value={audience.id}>
                    {audience.description}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void attachAudience(pickedAudienceId)}
                disabled={!pickedAudienceId || attachingAudience}
              >
                {attachingAudience ? 'Attaching…' : 'Attach'}
              </button>
              <button type="button" onClick={() => setReuseAudience(false)}>
                Add a new audience instead
              </button>
            </div>
          )}
          {audienceError && (
            <p className="form-error" role="alert">
              {audienceError}
            </p>
          )}
        </div>
      )}

      {step === 'strategy' && (
        <div aria-label="Generate a strategy for this campaign">
          <p>
            Your campaign is ready — generate a strategy to see targeting, budget, and ad
            copy recommendations.
          </p>
          <button
            type="button"
            onClick={() => void handleGenerateStrategy()}
            disabled={generatingStrategy}
          >
            {generatingStrategy ? 'Generating…' : 'Generate strategy'}
          </button>
          {needsAdExperienceAnswer && (
            <fieldset>
              <legend>Has this business run advertising campaigns before?</legend>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() => void handleGenerateStrategy(true)}
                  disabled={generatingStrategy}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerateStrategy(false)}
                  disabled={generatingStrategy}
                >
                  No
                </button>
              </div>
            </fieldset>
          )}
          {strategyError && (
            <p className="form-error" role="alert">
              {strategyError}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
