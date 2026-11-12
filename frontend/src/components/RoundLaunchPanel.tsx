import { useEffect, useState } from 'react'
import {
  ApiError,
  chooseRoundWinners,
  getRoundLaunchSummary,
  type RoundLaunchSummary,
} from '../lib/api'

interface RoundLaunchPanelProps {
  businessId: string
  campaignId: string
  roundId: string
  roundNumber: number
  // How many of the round's new ads are selected (the summary refreshes when it changes).
  selectedCount: number
  busy: boolean
  // What the publish button says while a publish runs (a video upload's step), if anything.
  publishLabel: string | null
  onPublish: (confirmRestart: boolean) => void
}

function dollars(amount: number): string {
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

// Everything the user confirms before a round of a creative test goes live: the new ad
// set and its budget, the winners ad set (the earlier ads still active, picked here when
// more than a round can carry), the most the round can spend, and a restart confirmation
// when the campaign is paused between rounds. A round of this kind publishes live.
export function RoundLaunchPanel({
  businessId,
  campaignId,
  roundId,
  roundNumber,
  selectedCount,
  busy,
  publishLabel,
  onPublish,
}: RoundLaunchPanelProps) {
  const [summary, setSummary] = useState<RoundLaunchSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [restartConfirmed, setRestartConfirmed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getRoundLaunchSummary(businessId, campaignId, roundId)
      .then((loaded) => {
        if (cancelled) return
        setSummary(loaded)
        setLoadError(null)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(describeError(e, 'Could not load the launch summary'))
      })
    return () => {
      cancelled = true
    }
  }, [businessId, campaignId, roundId, selectedCount])

  async function toggle(creativeId: string) {
    if (!summary) return
    const chosen = summary.winnerCandidates.filter((c) => c.chosen).map((c) => c.creativeId)
    const next = chosen.includes(creativeId)
      ? chosen.filter((id) => id !== creativeId)
      : [...chosen, creativeId]
    setPicking(true)
    setPickError(null)
    try {
      setSummary(await chooseRoundWinners(businessId, campaignId, roundId, next))
    } catch (e) {
      setPickError(describeError(e, 'Could not change the winners'))
    } finally {
      setPicking(false)
    }
  }

  if (loadError) {
    return (
      <p className="form-error" role="alert">
        {loadError}
      </p>
    )
  }
  if (!summary) return <p className="field-hint">Checking what this round will publish…</p>

  const winners = summary.winnerCandidates.filter((c) => c.chosen)
  const needsRestart = summary.restartsCampaign
  const blocked =
    busy || selectedCount === 0 || summary.needsChoice || (needsRestart && !restartConfirmed)
  const newAds = summary.newAdSet.adCount

  return (
    <div className="round-launch" aria-label={`Round ${roundNumber} launch summary`}>
      <ul className="round-launch-lines">
        <li>
          {newAds} new {newAds === 1 ? 'ad' : 'ads'} at {dollars(summary.newAdSet.dailyBudget)}/day
          in a new ad set
        </li>
        <li>
          {summary.winnersAdSet
            ? `${winners.length} ${winners.length === 1 ? 'winner' : 'winners'} from earlier rounds at ${dollars(summary.winnersAdSet.dailyBudget)}/day, in their own ad set`
            : 'No earlier ads are active, so there is no winners ad set.'}
        </li>
        <li>
          Together {dollars(summary.dailyTotal)}/day, up to {dollars(summary.plannedMax)} over{' '}
          {summary.durationDays} days. Both ad sets stop on day {summary.durationDays}.
        </li>
      </ul>

      {summary.winnerCandidates.length > 0 && (
        <fieldset className="round-winners" disabled={picking || busy}>
          <legend>Earlier ads to carry (up to {summary.maxWinners})</legend>
          {summary.needsChoice && (
            <p className="field-hint">
              More ads are active than a round can carry. Choose up to {summary.maxWinners} to
              carry; the rest stop with their round.
            </p>
          )}
          {summary.winnerCandidates.map((candidate) => (
            <label key={candidate.creativeId} className="round-winner">
              <input
                type="checkbox"
                checked={candidate.chosen}
                onChange={() => void toggle(candidate.creativeId)}
              />{' '}
              {candidate.headline}{' '}
              <span className="round-ad-carried">Carried from round {candidate.firstRound}</span>
            </label>
          ))}
        </fieldset>
      )}
      {pickError && (
        <p className="form-error" role="alert">
          {pickError}
        </p>
      )}

      {needsRestart && (
        <div className="round-restart" role="note">
          <p>
            Publishing this round restarts the paused campaign at {dollars(summary.dailyTotal)}/day.
          </p>
          <label>
            <input
              type="checkbox"
              checked={restartConfirmed}
              onChange={(e) => setRestartConfirmed(e.target.checked)}
            />{' '}
            Yes, restart the campaign with these budgets
          </label>
        </div>
      )}

      <button
        type="button"
        className="btn-generate"
        disabled={blocked}
        onClick={() => onPublish(needsRestart && restartConfirmed)}
      >
        {busy && publishLabel ? publishLabel : `Publish round ${roundNumber}`}
      </button>
    </div>
  )
}
