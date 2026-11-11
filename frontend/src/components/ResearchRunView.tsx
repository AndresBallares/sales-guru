import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  cancelResearchRun,
  getResearchRun,
  listAvatars,
  reopenResearchRun,
  type BuyerAvatar,
  type ResearchRun,
} from '../lib/api'
import {
  avatarHref,
  depthLabel,
  formatUsd,
  modelLabel,
} from '../lib/research'
import { ResearchProgressHub } from './ResearchProgressHub'
import { ResearchReadOnly } from './ResearchReadOnly'
import { ResearchReview } from './ResearchReview'

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

function FocusHeading({ id, children }: { id: string; children: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <h2 id={id} ref={ref} tabIndex={-1}>
      {children}
    </h2>
  )
}

// One run, whatever state it is in: progress while it works (polled), the review once it
// is ready, and a read-only summary after that. The run id is in the URL, so a refresh
// comes back here and picks the right view from the stored run.
export function ResearchRunView({
  businessId,
  runId,
  pollMs = 3000,
  onBack,
  onLibraryChanged,
  onOpenAvatar,
}: {
  businessId: string
  runId: string
  pollMs?: number
  onBack: () => void
  // Tells the page the avatar library changed, so its list reloads.
  onLibraryChanged: () => void
  // Opens the library with one avatar picked out (a link from a saved draft).
  onOpenAvatar: (avatarId: string) => void
}) {
  const [run, setRun] = useState<ResearchRun | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [library, setLibrary] = useState<BuyerAvatar[] | null>(null)
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setRun(await getResearchRun(businessId, runId))
    } catch (e) {
      setLoadError(message(e, 'Could not load this research run'))
    }
  }, [businessId, runId])

  useEffect(() => {
    void load()
  }, [load])

  const status = run?.status
  const active = status === 'QUEUED' || status === 'RUNNING'

  // Poll while the run is working. A failed poll is skipped; the next one tries again.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const timer = setTimeout(() => {
      getResearchRun(businessId, runId)
        .then((next) => {
          if (!cancelled) setRun(next)
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setTick((n) => n + 1)
        })
    }, pollMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [active, tick, businessId, runId, pollMs])

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])

  const needsLibrary = status === 'NEEDS_REVIEW' || status === 'REVIEWED'
  const loadLibrary = useCallback(async () => {
    setLibrary(await listAvatars(businessId).catch(() => []))
  }, [businessId])
  useEffect(() => {
    if (needsLibrary) void loadLibrary()
  }, [needsLibrary, loadLibrary])

  async function cancel() {
    setCanceling(true)
    setCancelError(null)
    try {
      setRun(await cancelResearchRun(businessId, runId))
    } catch (e) {
      setCancelError(message(e, 'Could not cancel the research'))
      setCanceling(false)
    }
  }

  async function reopen() {
    setReopening(true)
    setReopenError(null)
    try {
      setRun(await reopenResearchRun(businessId, runId))
    } catch (e) {
      setReopenError(message(e, 'Could not reopen the research'))
    } finally {
      setReopening(false)
    }
  }

  async function afterReview() {
    onLibraryChanged()
    await Promise.all([load(), loadLibrary()])
  }

  if (loadError && run === null) {
    return (
      <section>
        <p className="form-error" role="alert">
          {loadError}
        </p>
        <div className="avatar-actions">
          <button type="button" className="btn-outline" onClick={() => void load()}>
            Try again
          </button>
          <button type="button" className="btn-outline" onClick={onBack}>
            Back to avatars
          </button>
        </div>
      </section>
    )
  }
  if (run === null) return <p>Loading…</p>

  if (active) {
    return (
      <ResearchProgressHub
        run={run}
        now={now}
        heading={<FocusHeading id="research-progress-heading">Research in progress</FocusHeading>}
        canceling={canceling}
        cancelError={cancelError}
        onCancel={() => void cancel()}
        onBack={onBack}
      />
    )
  }

  if (status === 'NEEDS_REVIEW') {
    if (library === null) return <p>Loading…</p>
    return (
      <ResearchReview
        businessId={businessId}
        run={run}
        library={library}
        onSaved={() => void afterReview()}
        onDiscarded={() => void afterReview()}
        onDone={() => void afterReview()}
        onOpenAvatar={onOpenAvatar}
        onBack={onBack}
      />
    )
  }

  const titles = {
    FAILED: 'Research failed',
    CANCELED: 'Research canceled',
    DISCARDED: 'Research discarded',
    REVIEWED: 'Research done',
  } as const
  const title = titles[run.status as keyof typeof titles] ?? 'Research'
  const savedAvatars = run.savedAvatarIds.flatMap((id) => {
    const found = (library ?? []).find((a) => a.id === id)
    return found ? [found] : []
  })
  return (
    <section className="research-summary" aria-labelledby="research-summary-heading">
      <FocusHeading id="research-summary-heading">{title}</FocusHeading>
      <p>
        {depthLabel(run.depth)} research with {modelLabel(run.model)}: {run.searchesUsed} searches,{' '}
        {run.fetchesUsed} pages read, {formatUsd(run.costUsd)}.
      </p>
      {run.status === 'FAILED' && (
        <>
          <p>{run.error ?? 'The research stopped before it could finish.'}</p>
          <p className="field-hint">
            A failed run did not use one of your monthly runs. You can start again.
          </p>
        </>
      )}
      {run.status === 'CANCELED' && <p>You stopped this research before it finished.</p>}
      {run.status === 'DISCARDED' && (
        <p>You discarded this research without saving any avatars.</p>
      )}
      {run.status === 'REVIEWED' && (
        <>
          <p>
            You saved {run.savedAvatarIds.length}{' '}
            {run.savedAvatarIds.length === 1 ? 'avatar' : 'avatars'} to your library from this
            research. You marked it as done; reopen it to save more.
          </p>
          {savedAvatars.length > 0 && (
            <ul aria-label="Avatars saved from this research">
              {savedAvatars.map((a) => (
                <li key={a.id}>
                  <a
                    href={avatarHref(a.id)}
                    onClick={(event) => {
                      event.preventDefault()
                      onOpenAvatar(a.id)
                    }}
                  >
                    {a.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {reopenError && (
        <p className="form-error" role="alert">
          {reopenError}
        </p>
      )}
      <div className="avatar-actions">
        {run.status === 'REVIEWED' && (
          <button
            type="button"
            className="btn-outline"
            disabled={reopening}
            onClick={() => void reopen()}
          >
            Reopen to save more
          </button>
        )}
        <button type="button" className="btn-outline" onClick={onBack}>
          Back to avatars
        </button>
      </div>
      {(run.status === 'REVIEWED' || run.status === 'DISCARDED') && (
        <ResearchReadOnly run={run} library={library ?? []} onOpenAvatar={onOpenAvatar} />
      )}
    </section>
  )
}
