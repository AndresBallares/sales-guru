import type { ResearchRun } from './api'

// What the research progress card shows, worked out from the run the server reports.
// Nothing here invents progress: a stage is done only when the run's phase says so, and
// the card never shows a percentage (the server does not send one).

export type StageState = 'done' | 'active' | 'pending'
export type SegmentState = 'done' | 'active' | 'pending'

type RunLike = Pick<ResearchRun, 'status' | 'phase'>

// The runner's phases (brand, voice, findings, avatars) fall into three stages. Reading
// sources is "analyzing"; writing up the findings and drafting the avatars is "finalizing".
// A queued run has not started, and a phase this code does not know counts as analyzing, so
// an unexpected value can never claim the run is nearly done.
export function hubStages(run: RunLike): {
  started: StageState
  analyzing: StageState
  finalizing: StageState
} {
  if (run.status === 'QUEUED') {
    return { started: 'active', analyzing: 'pending', finalizing: 'pending' }
  }
  if (run.phase === 'findings' || run.phase === 'avatars') {
    return { started: 'done', analyzing: 'done', finalizing: 'active' }
  }
  return { started: 'done', analyzing: 'active', finalizing: 'pending' }
}

// The two lines between the three stages: emerald where both ends are done, gold into the
// stage that is working, grey beyond it.
export function hubSegments(stages: ReturnType<typeof hubStages>): [SegmentState, SegmentState] {
  const order = [stages.started, stages.analyzing, stages.finalizing]
  const segment = (from: StageState, to: StageState): SegmentState =>
    from === 'done' && to === 'done' ? 'done' : from === 'done' && to === 'active' ? 'active' : 'pending'
  return [segment(order[0], order[1]), segment(order[1], order[2])]
}

export type LiveLabel = 'Live' | 'Waiting' | 'Stopping'

export function liveIndicator(run: RunLike & Pick<ResearchRun, 'cancelRequested'>): LiveLabel {
  if (run.cancelRequested) return 'Stopping'
  return run.status === 'QUEUED' ? 'Waiting' : 'Live'
}

// The local time the run started, such as "2:41 PM"; null until there is one to show.
export function startedClock(startedAt: string | null): string | null {
  if (!startedAt) return null
  const at = new Date(startedAt)
  if (Number.isNaN(at.getTime())) return null
  return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// The card's colour pairs, checked in the test: text needs 4.5:1, an icon that carries
// meaning 3:1. They mirror the custom properties on `.research-hub` in index.css.
export const HUB_PAIRS: { name: string; fg: string; bg: string; min: number }[] = [
  { name: 'light: text on the card', fg: '#17211D', bg: '#FFFDF9', min: 4.5 },
  { name: 'light: text on the champagne panel', fg: '#17211D', bg: '#F0E5D9', min: 4.5 },
  { name: 'light: muted text on the card', fg: '#62666A', bg: '#FFFDF9', min: 4.5 },
  { name: 'light: muted text on the page', fg: '#62666A', bg: '#F8F4EF', min: 4.5 },
  { name: 'light: muted text on the champagne panel', fg: '#565A5E', bg: '#F0E5D9', min: 4.5 },
  { name: 'light: the timer', fg: '#064B35', bg: '#FFFDF9', min: 4.5 },
  { name: 'light: the clock on its green disc', fg: '#064B35', bg: '#DCEBE2', min: 3 },
  { name: 'light: text on the Live pill', fg: '#131318', bg: '#ECD68A', min: 4.5 },
  { name: 'light: green dot on the Live pill', fg: '#0B6B4C', bg: '#ECD68A', min: 3 },
  { name: 'light: text on the primary button', fg: '#131318', bg: '#ECD68A', min: 4.5 },
  { name: 'light: white on the gold stage icon', fg: '#FFFFFF', bg: '#9A6218', min: 3 },
  { name: 'light: gold icon on the champagne panel', fg: '#8A5A14', bg: '#F0E5D9', min: 3 },
  { name: 'light: emerald diamond on the glass', fg: '#064B35', bg: '#FFFDF9', min: 3 },
  { name: 'dark: text on the card', fg: '#F4EFE8', bg: '#14211C', min: 4.5 },
  { name: 'dark: muted text on the card', fg: '#BDB6AA', bg: '#14211C', min: 4.5 },
  { name: 'dark: muted text on the panel', fg: '#BDB6AA', bg: '#1D2C26', min: 4.5 },
  { name: 'dark: the timer', fg: '#7FD8B0', bg: '#14211C', min: 4.5 },
  { name: 'dark: the clock on its disc', fg: '#7FD8B0', bg: '#1F3A30', min: 3 },
  { name: 'dark: text on the primary button', fg: '#131318', bg: '#ECD68A', min: 4.5 },
  { name: 'dark: text on the Live pill', fg: '#131318', bg: '#ECD68A', min: 4.5 },
  { name: 'dark: gold icon on the panel', fg: '#E7C58D', bg: '#1D2C26', min: 3 },
]
