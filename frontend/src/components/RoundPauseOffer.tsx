import { useState } from 'react'
import { ApiError, approveRecommendation, offerRoundPauses, rejectRecommendation } from '../lib/api'
import type { Recommendation } from '../lib/api'

interface Props {
  businessId: string
  campaignId: string
}

type Decision = 'paused' | 'kept'

// Before a new round, the user can ask which earlier ads the pause rules call losers. This only
// lists proposals; an ad is paused only when the user approves that proposal.
export function RoundPauseOffer({ businessId, campaignId }: Props) {
  const [offers, setOffers] = useState<Recommendation[] | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setBusy(true)
    setError('')
    try {
      setOffers(await offerRoundPauses(businessId, campaignId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check the ads.')
    } finally {
      setBusy(false)
    }
  }

  async function decide(offer: Recommendation, decision: Decision) {
    setError('')
    try {
      if (decision === 'paused') {
        await approveRecommendation(businessId, campaignId, offer.id)
      } else {
        await rejectRecommendation(businessId, campaignId, offer.id)
      }
      setDecisions((prev) => ({ ...prev, [offer.id]: decision }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that choice.')
    }
  }

  return (
    <section className="round-pause-offer" aria-label="Free up budget before a new round">
      <h4>Free up budget before a new round</h4>
      <p>Check whether any ad is losing so you can pause it. Nothing is paused unless you say so.</p>
      <button type="button" onClick={load} disabled={busy}>
        See which ads to pause
      </button>
      {error && <p role="alert">{error}</p>}
      {offers !== null && offers.length === 0 && <p>No ads need pausing yet.</p>}
      {offers !== null && offers.length > 0 && (
        <ul>
          {offers.map((offer) => (
            <li key={offer.id}>
              <p>{offer.reasoning}</p>
              {decisions[offer.id] === 'paused' && <p>Paused</p>}
              {decisions[offer.id] === 'kept' && <p>Kept running</p>}
              {decisions[offer.id] === undefined && (
                <>
                  <button type="button" onClick={() => decide(offer, 'paused')}>
                    Pause this ad
                  </button>
                  <button type="button" onClick={() => decide(offer, 'kept')}>
                    Keep it running
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
