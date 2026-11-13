import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  createRound,
  deleteRound,
  endRoundEarly,
  getPublishStatus,
  getRoundsOverview,
  listRounds,
  publishRound,
  setRoundCreativeSelected,
  type CreativeRound,
  type RoundsOverview as RoundsOverviewData,
} from '../lib/api'
import { angleLabel } from '../lib/creativeAngle'
import { RoundLaunchPanel } from './RoundLaunchPanel'
import { RoundPauseOffer } from './RoundPauseOffer'
import { RoundsOverview } from './RoundsOverview'
import { SavedConceptNote } from './SavedConceptNote'

interface CreativeRoundsPanelProps {
  businessId: string
  campaignId: string
  // Where the plan keeps its budget: 'AD_SET' rounds run on their own ad-set budgets for
  // ten days and carry earlier winners into a winners ad set. Anything else is an older
  // campaign that shares one budget between its ad sets, which can no longer take rounds.
  roundsBudget?: 'CAMPAIGN' | 'AD_SET'
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
// one to four of them, and publish them as a new ad set inside the same campaign.
// A campaign that shares one budget between its ad sets can't take rounds any more.
export function CreativeRoundsPanel({
  businessId,
  campaignId,
  roundsBudget,
  pollMs = 2000,
}: CreativeRoundsPanelProps) {
  const adSetRounds = roundsBudget === 'AD_SET'
  const [rounds, setRounds] = useState<CreativeRound[] | null>(null)
  const [overview, setOverview] = useState<RoundsOverviewData | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    try {
      const [next, published] = await Promise.all([
        listRounds(businessId, campaignId),
        adSetRounds ? getRoundsOverview(businessId, campaignId) : Promise.resolve(null),
      ])
      if (!mounted.current) return
      setRounds(next)
      setOverview(published)
    } catch (e) {
      if (mounted.current) setError(message(e, 'Could not load the rounds'))
    }
  }, [businessId, campaignId, adSetRounds])

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
        status.progress != null
          ? `${status.step ?? 'Working'} ${status.progress}%`
          : (status.step ?? 'Working'),
      )
      await sleep(pollMs)
    }
  }

  const hasOpenRound = rounds?.some((r) => r.status === 'OPEN') ?? false
  const locked = adSetRounds && overview?.nextRoundProblem != null

  return (
    <section className="rounds-panel" aria-labelledby="rounds-heading">
      <h3 id="rounds-heading">New rounds</h3>
      {adSetRounds && (
        <RoundsOverview
          rounds={overview?.rounds ?? []}
          busy={busy !== null}
          onEndEarly={async () => {
            try {
              await endRoundEarly(businessId, campaignId)
              await load()
            } catch (e) {
              if (mounted.current) setError(message(e, 'Could not end the round'))
            }
          }}
        />
      )}
      {adSetRounds ? (
        <p className="field-hint">
          Each round is four new ads at the test&apos;s daily budget in their own ad set for ten
          days. The earlier ads you left active carry on in a winners ad set beside them.
        </p>
      ) : (
        <p className="field-hint rounds-unavailable">
          This campaign uses a shared campaign budget, and new rounds can no longer be added to
          those: every round now runs on ad sets that each have their own budget. Start a new
          campaign to run more rounds.
        </p>
      )}

      {adSetRounds && (
        <button
          type="button"
          className="btn-outline"
          disabled={busy !== null || hasOpenRound || rounds === null || locked}
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
      {adSetRounds && hasOpenRound && (
        <p className="field-hint">Publish or delete the open round before adding another.</p>
      )}
      {locked && !hasOpenRound && <p className="field-hint">{overview?.nextRoundProblem}</p>}
      {adSetRounds && <RoundPauseOffer businessId={businessId} campaignId={campaignId} />}

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
                {open ? 'Open' : 'Published'}
              </span>
            </header>
            <ul className="round-angles">
              {round.angles.map((angle) => (
                <li key={`${angle.avatar}-${angle.concept}`}>
                  <strong>{angleLabel(angle)}</strong>
                  {angle.description ? ` — ${angle.description}` : ''}
                  {angle.fromSavedConcept && (
                    <>
                      {' '}
                      <SavedConceptNote />
                    </>
                  )}
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
            {open && adSetRounds && (
              <div className="round-actions">
                <RoundLaunchPanel
                  businessId={businessId}
                  campaignId={campaignId}
                  roundId={round.id}
                  roundNumber={round.number}
                  selectedCount={selected.length}
                  busy={busy !== null}
                  publishLabel={busy === `publish-${round.id}` ? (step ?? 'Publishing…') : null}
                  onPublish={(confirmRestart) =>
                    void run(`publish-${round.id}`, async () => {
                      await publishRound(businessId, campaignId, round.id, { confirmRestart })
                      await waitForPublish()
                      await load()
                    })
                  }
                />
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
            {open && !adSetRounds && (
              <div className="round-actions">
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
