import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ResearchProgressHub } from './ResearchProgressHub'
import { makeRun } from '../test/researchFixtures'
import type { ResearchRun } from '../lib/api'

const STARTED = '2026-11-10T14:41:00Z'
const NOW = Date.parse(STARTED) + 157_000

const running = (over: Partial<ResearchRun> = {}) =>
  makeRun({
    status: 'RUNNING',
    phase: 'voice',
    searchesUsed: 30,
    maxSearches: 40,
    fetchesUsed: 37,
    maxFetches: 60,
    costUsd: 4.28,
    finishedAt: null,
    startedAt: STARTED,
    ...over,
  })

function renderHub(run: ResearchRun, over: Partial<Parameters<typeof ResearchProgressHub>[0]> = {}) {
  const onCancel = vi.fn<() => void>()
  const onBack = vi.fn<() => void>()
  render(
    <ResearchProgressHub
      run={run}
      now={NOW}
      heading={<h2 id="h">Research in progress</h2>}
      canceling={false}
      cancelError={null}
      onCancel={onCancel}
      onBack={onBack}
      {...over}
    />,
  )
  return { onCancel, onBack }
}

describe('the timer', () => {
  it('shows the real elapsed time from the start time, large, with "so far"', () => {
    renderHub(running())
    const timer = screen.getByRole('timer')
    expect(timer).toHaveTextContent('2m 37s')
    expect(screen.getByText('so far')).toBeInTheDocument()
  })

  it('is not read out every second', () => {
    renderHub(running())
    const timer = screen.getByRole('timer')
    expect(timer.closest('[aria-live="polite"], [aria-live="assertive"]')).toBeNull()
  })

  it('reads 0s for a run that has not started', () => {
    renderHub(running({ status: 'QUEUED', phase: null, startedAt: null }))
    expect(screen.getByRole('timer')).toHaveTextContent('0s')
  })
})

describe('the stages', () => {
  const stage = (name: string) => screen.getByRole('listitem', { name: new RegExp(name) })

  it('marks the first stage done with its start time, and analyzing in progress', () => {
    renderHub(running({ phase: 'voice' }))
    expect(stage('Research Started')).toHaveTextContent(/\d{1,2}:41/)
    expect(stage('Research Started')).toHaveTextContent('Done')
    expect(stage('Analyzing Data')).toHaveTextContent('In Progress')
    expect(stage('Analyzing Data')).toHaveAttribute('aria-current', 'step')
    expect(stage('Finalizing Results')).toHaveTextContent('Coming Soon')
  })

  it('moves to finalizing when the run is writing up the findings', () => {
    renderHub(running({ phase: 'findings' }))
    expect(stage('Analyzing Data')).toHaveTextContent('Done')
    expect(stage('Finalizing Results')).toHaveTextContent('In Progress')
    expect(stage('Finalizing Results')).toHaveAttribute('aria-current', 'step')
  })

  it('has not started a queued run', () => {
    renderHub(running({ status: 'QUEUED', phase: null, startedAt: null }))
    expect(stage('Research Started')).toHaveTextContent('Queued')
    expect(stage('Analyzing Data')).toHaveTextContent('Coming Soon')
  })

  it('shows no percentage', () => {
    renderHub(running())
    expect(document.body.textContent).not.toMatch(/\d+\s?%/)
  })
})

describe('the live pill', () => {
  it('says Live while working', () => {
    renderHub(running())
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('says Waiting for a queued run', () => {
    renderHub(running({ status: 'QUEUED', phase: null, startedAt: null }))
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
  })

  it('says Stopping after a cancel request, with the existing explanation', () => {
    renderHub(running({ cancelRequested: true }))
    expect(screen.getByText('Stopping')).toBeInTheDocument()
    expect(screen.getByText(/Stopping after the current step/)).toBeInTheDocument()
  })
})

describe('the numbers', () => {
  it('shows the real searches, pages read and spend', () => {
    renderHub(running())
    const stats = screen.getByRole('list', { name: 'Research so far' })
    expect(within(stats).getByText('30 of 40 searches')).toBeInTheDocument()
    expect(within(stats).getByText('37 of 60 pages read')).toBeInTheDocument()
    expect(within(stats).getByText('$4.28 spent so far')).toBeInTheDocument()
  })

  it('does not show a cost per lead, which research does not have', () => {
    renderHub(running())
    expect(document.body.textContent).not.toMatch(/per lead/i)
  })
})

describe('the actions and the picture', () => {
  it('cancels through the handler and disables while canceling', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderHub(running())
    await user.click(screen.getByRole('button', { name: 'Cancel research' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('disables Cancel once canceling or a cancel was requested', () => {
    renderHub(running({ cancelRequested: true }))
    expect(screen.getByRole('button', { name: 'Cancel research' })).toBeDisabled()
  })

  it('goes back without cancelling', async () => {
    const user = userEvent.setup()
    const { onBack, onCancel } = renderHub(running())
    await user.click(screen.getByRole('button', { name: 'Back to avatars' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('shows a cancel error', () => {
    renderHub(running(), { cancelError: 'Could not cancel the research' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not cancel the research')
  })

  it('hides the decorative illustration from assistive technology', () => {
    const { container } = render(
      <ResearchProgressHub
        run={running()}
        now={NOW}
        heading={<h2>Research in progress</h2>}
        canceling={false}
        cancelError={null}
        onCancel={() => undefined}
        onBack={() => undefined}
      />,
    )
    expect(container.querySelector('.hub-art')).toHaveAttribute('aria-hidden', 'true')
  })
})
