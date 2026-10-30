import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  createRound,
  deleteRound,
  getPublishStatus,
  listRounds,
  publishRound,
  setRoundCreativeSelected,
  type Campaign,
  type CreativeRound,
} from '../lib/api'
import { angleLabel } from '../lib/creativeAngle'

interface CreativeRoundsPanelProps {
  businessId: string
  campaignId: string
  budgetLevel: Campaign['budgetLevel']
  // How often a background (video) publish is checked, in milliseconds.
  pollMs?: number
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Follow-up rounds of a published creative test: generate four new ads (three when
// the product lacks a fourth photo or video) on angles the test has not used, pick
// one to four of them, and publish them as a new pack inside the same campaign.
export function CreativeRoundsPanel({
  businessId,
  campaignId,
  budgetLevel,
  pollMs = 2000,
}: CreativeRoundsPanelProps) {
  const [rounds, setRounds] = useState<CreativeRound[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    try {
      const next = await listRounds(businessId, campaignId)
      if (mounted.current) setRounds(next)
    } catch (e) {
      if (mounted.current) setError(message(e, 'Could not load the rounds'))
    }
  }, [businessId, campaignId])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
    }
  }, [load])

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (e) {
      if (mounted.current) setError(message(e, 'Something went wrong'))
    } finally {
      if (mounted.current) {
        setBusy(null)
        setStep(null)
      }
    }
  }

  // A video round publishes in the background: wait for it, showing its step.
  async function waitForPublish() {
    for (;;) {
      const status = await getPublishStatus(businessId, campaignId)
      if (!mounted.current) return
      if (status.state === 'FAILED') {
        throw new Error(status.error ?? 'The round could not be published')
      }
      if (status.state !== 'PROCESSING') return
      setStep(
        status.progress != null ? `${status.step ?? 'Working'} ${status.progress}%` : status.step ?? 'Working',
      )
      await sleep(pollMs)
    }
  }

  const hasOpenRound = rounds?.some((r) => r.status === 'OPEN') ?? false
  const canAdd = budgetLevel === 'CAMPAIGN'

  return (
    <section className="rounds-panel" aria-labelledby="rounds-heading">
      <h3 id="rounds-heading">New rounds</h3>
      {canAdd ? (
        <p className="field-hint">
          Add four new ads on fresh angles (three if the product lacks a fourth photo or video),
          choose one to four, and publish them as a new pack in this campaign.
        </p>
      ) : (
        <p className="field-hint rounds-unavailable">
          This campaign was published before campaigns had one budget shared by their ad sets: its
          budget sits on its single ad set, so it can&apos;t take a new pack. Start a new creative
          test to run more rounds.
        </p>
      )}

      {canAdd && (
        <button
          type="button"
          className="btn-outline"
          disabled={busy !== null || hasOpenRound || rounds === null}
          onClick={() =>
            void run('add', async () => {
              await createRound(businessId, campaignId)
              await load()
            })
          }
        >
          {busy === 'add' ? 'Generating ads…' : 'Add new round'}
        </button>
      )}
      {canAdd && hasOpenRound && (
        <p className="field-hint">Publish or delete the open round before adding another.</p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {(rounds ?? []).map((round) => {
        const open = round.status === 'OPEN'
        const selected = round.creatives.filter((c) => c.status === 'SELECTED')
        return (
          <article key={round.id} className="round-card" aria-label={`Round ${round.number}`}>
            <header className="round-card-header">
              <h4>Round {round.number}</h4>
              <span className="round-card-status">
                {open ? 'Open' : `Published as Pack ${round.number}`}
              </span>
            </header>
            <ul className="round-angles">
              {round.angles.map((angle) => (
                <li key={`${angle.avatar}-${angle.concept}`}>
                  <strong>{angleLabel(angle)}</strong>
                  {angle.description ? ` — ${angle.description}` : ''}
                </li>
              ))}
            </ul>
            <ul className="round-ads">
              {round.creatives.map((creative) => {
                const isSelected = creative.status === 'SELECTED'
                return (
                  <li key={creative.id} className="round-ad">
                    {creative.imageUrl && (
                      <img src={creative.imageUrl} alt="" width={96} height={96} />
                    )}
                    <div>
                      <p className="round-ad-headline">{creative.headline}</p>
                      <p>{creative.bodyText}</p>
                    </div>
                    {open ? (
                      <button
                        type="button"
                        className="btn-outline"
                        aria-pressed={isSelected}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(creative.id, async () => {
                            await setRoundCreativeSelected(
                              businessId,
                              campaignId,
                              round.id,
                              creative.id,
                              !isSelected,
                            )
                            await load()
                          })
                        }
                      >
                        {isSelected ? 'Remove from selection' : 'Select this ad'}
                      </button>
                    ) : (
                      isSelected && <span className="round-ad-live">Live</span>
                    )}
                  </li>
                )
              })}
            </ul>
            {open && (
              <div className="round-actions">
                <label className="round-paused">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(e) => setPaused(e.target.checked)}
                  />
                  Publish paused
                </label>
                <button
                  type="button"
                  className="btn-generate"
                  disabled={busy !== null || selected.length === 0}
                  onClick={() =>
                    void run(`publish-${round.id}`, async () => {
                      await publishRound(businessId, campaignId, round.id, { paused })
                      await waitForPublish()
                      await load()
                    })
                  }
                >
                  {busy === `publish-${round.id}`
                    ? (step ?? 'Publishing…')
                    : `Publish ${selected.length} ${selected.length === 1 ? 'ad' : 'ads'} as Pack ${round.number}`}
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`delete-${round.id}`, async () => {
                      await deleteRound(businessId, campaignId, round.id)
                      await load()
                    })
                  }
                >
                  Delete round
                </button>
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}
