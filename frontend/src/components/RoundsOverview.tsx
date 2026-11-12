import { useState } from 'react'
import type { PublishedRound } from '../lib/api'

interface RoundsOverviewProps {
  rounds: PublishedRound[]
  // Something else on the screen is running (a publish, a generation).
  busy: boolean
  // The current time; a test passes its own.
  now?: Date
  onEndEarly: () => Promise<void>
}

function day(iso: string | null): string {
  if (!iso) return '?'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dollars(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function spent(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// The published rounds of a creative test: each round's ad sets with their dates, daily
// budget and spend so far, the ads in them (a winner says which round it first ran in),
// and, while the latest round is still running, End round early behind a confirmation.
export function RoundsOverview({ rounds, busy, now, onEndEarly }: RoundsOverviewProps) {
  const [confirming, setConfirming] = useState(false)
  const [ending, setEnding] = useState(false)
  if (rounds.length === 0) return null

  const latest = rounds.reduce((a, b) => (b.number > a.number ? b : a))
  const current = (now ?? new Date()).getTime()
  const running = latest.endsAt !== null && new Date(latest.endsAt).getTime() > current

  async function end() {
    setEnding(true)
    try {
      await onEndEarly()
    } finally {
      setEnding(false)
      setConfirming(false)
    }
  }

  return (
    <div className="rounds-overview">
      {rounds.map((round, index) => (
        <article
          key={`${round.number}-${index}`}
          className="round-card"
          aria-label={`Published round ${round.number}`}
        >
          <header className="round-card-header">
            <h4>Round {round.number}</h4>
            <span className="round-card-status">
              {day(round.startsAt)} to {day(round.endsAt)}
              {round.number === latest.number && !running && ' · finished'}
            </span>
          </header>
          {round.adSets.map((adSet) => (
            <section key={adSet.id} className="round-adset" aria-label={adSet.name}>
              <h5>
                {adSet.name}
                {adSet.isWinners && <span className="round-adset-tag">Winners</span>}
              </h5>
              <p className="field-hint">
                {dollars(adSet.dailyBudget)}/day · {day(adSet.startDate)} to {day(adSet.endDate)} ·{' '}
                {spent(adSet.spend)} spent so far
              </p>
              <ul className="round-ads">
                {adSet.ads.map((ad) => (
                  <li key={ad.adId} className="round-ad">
                    <div>
                      <p className="round-ad-headline">{ad.headline ?? ad.name}</p>
                      <p className="field-hint">
                        {spent(ad.spend)} spent so far
                        {ad.carriedFromRound !== null && (
                          <>
                            {' · '}
                            <span className="round-ad-carried">
                              Carried from round {ad.carriedFromRound}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </article>
      ))}

      {running && !confirming && (
        <button
          type="button"
          className="btn-outline"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          End round early
        </button>
      )}
      {running && confirming && (
        <div className="round-end-early" role="group" aria-label="Confirm ending the round">
          <p>
            This stops round {latest.number}&apos;s ads now and pauses the campaign. You can start
            the next round right away.
          </p>
          <div className="button-row">
            <button type="button" className="btn-outline" disabled={ending} onClick={end}>
              End round {latest.number} now
            </button>
            <button
              type="button"
              className="cancel-link"
              disabled={ending}
              onClick={() => setConfirming(false)}
            >
              Keep it running
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
