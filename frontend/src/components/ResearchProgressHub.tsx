import type { ReactNode } from 'react'
import type { ResearchRun } from '../lib/api'
import { elapsedLabel, formatUsd, phaseLabel } from '../lib/research'
import {
  hubSegments,
  hubStages,
  liveIndicator,
  startedClock,
  type StageState,
} from '../lib/researchProgress'
import {
  ArrowRightIcon,
  BarsIcon,
  CheckIcon,
  ClockIcon,
  DiamondIcon,
  DollarIcon,
  PagesIcon,
  SearchIcon,
} from './researchHubIcons'

function Illustration() {
  return (
    <div className="hub-art" aria-hidden="true">
      <div className="hub-scene">
        <div className="hub-orbit hub-orbit-a">
          <span className="hub-bead" />
        </div>
        <div className="hub-orbit hub-orbit-b">
          <span className="hub-bead" />
        </div>
        <div className="hub-stack">
          <div className="hub-plate hub-plate-base" />
          <div className="hub-plate hub-plate-mid" />
          <div className="hub-plate hub-plate-top" />
          <div className="hub-panel">
            <svg viewBox="0 0 64 64" width="44" height="44" fill="none" focusable="false">
              <defs>
                <linearGradient id="hub-gold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#F3D9A4" />
                  <stop offset="0.5" stopColor="#C6923E" />
                  <stop offset="1" stopColor="#A86F20" />
                </linearGradient>
              </defs>
              <circle cx="27" cy="27" r="16" stroke="url(#hub-gold)" strokeWidth="6" />
              <path d="m40 40 15 15" stroke="url(#hub-gold)" strokeWidth="7" strokeLinecap="round" />
            </svg>
          </div>
        </div>
        <div className="hub-shadow" />
      </div>
    </div>
  )
}

const STAGE_WORDS: Record<StageState, string> = {
  done: 'Done',
  active: 'In Progress',
  pending: 'Coming Soon',
}

function Stage({
  title,
  state,
  icon,
  word,
  detail,
}: {
  title: string
  state: StageState
  icon: ReactNode
  word: string
  detail?: string | null
}) {
  return (
    <li
      className="hub-stage"
      data-state={state}
      aria-current={state === 'active' ? 'step' : undefined}
      aria-label={`${title}: ${word}${detail ? `, ${detail}` : ''}`}
    >
      <span className="hub-stage-icon">{icon}</span>
      <span className="hub-stage-title">{title}</span>
      <span className="hub-stage-word">{word}</span>
      {detail && <span className="hub-stage-detail">{detail}</span>}
    </li>
  )
}

// The card that shows a working research run: live timer, three stages, the real counts and
// the two actions. Everything shown comes from the run the server reports.
export function ResearchProgressHub({
  run,
  now,
  heading,
  canceling,
  cancelError,
  onCancel,
  onBack,
}: {
  run: ResearchRun
  now: number
  heading: ReactNode
  canceling: boolean
  cancelError: string | null
  onCancel: () => void
  onBack: () => void
}) {
  const stages = hubStages(run)
  const [first, second] = hubSegments(stages)
  const live = liveIndicator(run)
  const clock = startedClock(run.startedAt)
  const queued = run.status === 'QUEUED'

  return (
    <section className="research-progress research-hub" aria-labelledby="research-progress-heading">
      <header className="hub-head">
        {heading}
        <p aria-live="polite" className="research-phase hub-sub">
          {phaseLabel(run.status, run.phase)}
        </p>
        <span className="hub-rule" aria-hidden="true" />
      </header>

      <div className="hub-card">
        <span className="hub-live" data-live={live}>
          <span className="hub-live-dot" aria-hidden="true" />
          {live}
        </span>

        <Illustration />

        <div className="hub-center">
          <div className="hub-timer-row">
            <span className="hub-clock" aria-hidden="true">
              <ClockIcon size={34} />
            </span>
            <div>
              <p role="timer" className="hub-timer">
                {elapsedLabel(run.startedAt, run.finishedAt, now)}
              </p>
              <p className="hub-so-far">so far</p>
            </div>
          </div>

          <ol className="hub-stages" aria-label="Research stages" data-first={first} data-second={second}>
            <Stage
              title="Research Started"
              state={stages.started}
              icon={queued ? <ClockIcon size={22} /> : <CheckIcon />}
              word={queued ? 'Queued' : STAGE_WORDS.done}
              detail={clock ? `Started ${clock}` : null}
            />
            <Stage
              title="Analyzing Data"
              state={stages.analyzing}
              icon={<BarsIcon />}
              word={STAGE_WORDS[stages.analyzing]}
            />
            <Stage
              title="Finalizing Results"
              state={stages.finalizing}
              icon={<DiamondIcon />}
              word={STAGE_WORDS[stages.finalizing]}
            />
          </ol>
        </div>

        <ul className="hub-stats" aria-label="Research so far">
          <li>
            <span className="hub-stat-icon">
              <SearchIcon size={22} />
            </span>
            <span>
              {run.searchesUsed} of {run.maxSearches} searches
            </span>
          </li>
          <li>
            <span className="hub-stat-icon">
              <PagesIcon size={22} />
            </span>
            <span>
              {run.fetchesUsed} of {run.maxFetches} pages read
            </span>
          </li>
          <li>
            <span className="hub-stat-icon">
              <DollarIcon size={22} />
            </span>
            <span>{formatUsd(run.costUsd)} spent so far</span>
          </li>
        </ul>

        <div className="hub-footer">
          <p className="field-hint hub-hint">
            You can leave this page. The research keeps going, and this screen picks it up again
            when you come back.
          </p>
          {cancelError && (
            <p className="form-error" role="alert">
              {cancelError}
            </p>
          )}
          {run.cancelRequested && (
            <p className="hub-stopping">Stopping after the current step. What it found so far is kept.</p>
          )}
          <div className="hub-actions">
            <button
              type="button"
              className="hub-btn hub-btn-quiet"
              disabled={canceling || run.cancelRequested}
              onClick={onCancel}
            >
              Cancel research
            </button>
            <button type="button" className="hub-btn hub-btn-primary" onClick={onBack}>
              Back to avatars
              <ArrowRightIcon />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
