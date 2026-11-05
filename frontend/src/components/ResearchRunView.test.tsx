import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchRunView } from './ResearchRunView'
import * as api from '../lib/api'
import { makeRun } from '../test/researchFixtures'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getResearchRun: vi.fn<typeof actual.getResearchRun>(),
    cancelResearchRun: vi.fn<typeof actual.cancelResearchRun>(),
    listAvatars: vi.fn<typeof actual.listAvatars>(),
    bulkCreateAvatars: vi.fn<typeof actual.bulkCreateAvatars>(),
    markResearchRunDone: vi.fn<typeof actual.markResearchRunDone>(),
    reopenResearchRun: vi.fn<typeof actual.reopenResearchRun>(),
    discardResearchRun: vi.fn<typeof actual.discardResearchRun>(),
  }
})
const mockedApi = vi.mocked(api)

function renderView(runId = 'run-1') {
  const onBack = vi.fn<() => void>()
  const onLibraryChanged = vi.fn<() => void>()
  const onOpenAvatar = vi.fn<(id: string) => void>()
  render(
    <MemoryRouter>
      <ResearchRunView
        businessId="biz-1"
        runId={runId}
        pollMs={10}
        onBack={onBack}
        onLibraryChanged={onLibraryChanged}
        onOpenAvatar={onOpenAvatar}
      />
    </MemoryRouter>,
  )
  return { onBack, onLibraryChanged, onOpenAvatar }
}

function renderViewWithUnmount() {
  return render(
    <MemoryRouter>
      <ResearchRunView
        businessId="biz-1"
        runId="run-1"
        pollMs={10}
        onBack={vi.fn<() => void>()}
        onLibraryChanged={vi.fn<() => void>()}
        onOpenAvatar={vi.fn<(id: string) => void>()}
      />
    </MemoryRouter>,
  )
}

const running = (over: Partial<api.ResearchRun> = {}) =>
  makeRun({
    status: 'RUNNING',
    phase: 'voice',
    searchesUsed: 4,
    fetchesUsed: 6,
    costUsd: 0.42,
    finishedAt: null,
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    ...over,
  })

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.listAvatars.mockResolvedValue([])
})

describe('progress', () => {
  it('shows the phase in plain words, the counts, the cost and the time', async () => {
    mockedApi.getResearchRun.mockResolvedValue(running())
    renderView()
    const progress = await screen.findByRole('region', { name: 'Research in progress' })
    expect(within(progress).getByText('Looking for what customers say')).toBeInTheDocument()
    expect(progress).toHaveTextContent('4 of 15 searches')
    expect(progress).toHaveTextContent('6 of 20 pages read')
    expect(progress).toHaveTextContent('$0.42')
    expect(progress).toHaveTextContent(/1m \d+s/)
  })

  it('announces the phase politely', async () => {
    mockedApi.getResearchRun.mockResolvedValue(running())
    renderView()
    const phase = await screen.findByText('Looking for what customers say')
    expect(phase.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
  })

  it('keeps polling and moves to the review when the run is ready', async () => {
    mockedApi.getResearchRun
      .mockResolvedValueOnce(running())
      .mockResolvedValueOnce(running({ phase: 'avatars' }))
      .mockResolvedValue(makeRun())
    renderView()
    expect(await screen.findByText('Looking for what customers say')).toBeInTheDocument()
    expect(await screen.findByText('Drafting avatars')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: 'Review the research' })).toBeInTheDocument()
    const calls = mockedApi.getResearchRun.mock.calls.length
    await new Promise((r) => setTimeout(r, 60))
    expect(mockedApi.getResearchRun.mock.calls.length).toBe(calls)
  })

  it('says a queued run is waiting', async () => {
    mockedApi.getResearchRun.mockResolvedValue(running({ status: 'QUEUED', phase: null, startedAt: null }))
    renderView()
    expect(await screen.findByText('Waiting to start')).toBeInTheDocument()
  })

  it('cancels a run and shows that it is stopping', async () => {
    const user = userEvent.setup()
    mockedApi.getResearchRun.mockResolvedValue(running())
    mockedApi.cancelResearchRun.mockImplementation(() => {
      // From now on the server reports the request, as the real one does.
      mockedApi.getResearchRun.mockResolvedValue(running({ cancelRequested: true }))
      return Promise.resolve(running({ cancelRequested: true }))
    })
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Cancel research' }))
    expect(mockedApi.cancelResearchRun).toHaveBeenCalledWith('biz-1', 'run-1')
    expect(await screen.findByText(/Stopping after the current step/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel research' })).toBeDisabled()
  })

  it('shows a failed cancel', async () => {
    const user = userEvent.setup()
    mockedApi.getResearchRun.mockResolvedValue(running())
    mockedApi.cancelResearchRun.mockRejectedValue(new api.ApiError(409, 'This run has already finished'))
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Cancel research' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already finished')
  })

  it('keeps showing the run when one poll fails', async () => {
    mockedApi.getResearchRun
      .mockResolvedValueOnce(running())
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(running({ phase: 'findings' }))
    renderView()
    expect(await screen.findByText('Writing up problems and solutions')).toBeInTheDocument()
  })

  it('moves focus to the heading', async () => {
    mockedApi.getResearchRun.mockResolvedValue(running())
    renderView()
    const heading = await screen.findByRole('heading', { level: 2, name: 'Research in progress' })
    await waitFor(() => expect(heading).toHaveFocus())
  })
})

describe('after the run', () => {
  it('tells the owner a failed run did not use a monthly run and why it failed', async () => {
    mockedApi.getResearchRun.mockResolvedValue(
      makeRun({ status: 'FAILED', error: 'Research stopped: the cost cap was reached.', stopReason: 'cap' }),
    )
    renderView()
    expect(await screen.findByRole('heading', { level: 2, name: 'Research failed' })).toBeInTheDocument()
    expect(screen.getByText(/the cost cap was reached/)).toBeInTheDocument()
    expect(screen.getByText(/did not use one of your monthly runs/)).toBeInTheDocument()
  })

  it('shows a canceled run', async () => {
    mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'CANCELED', stopReason: 'canceled' }))
    renderView()
    expect(await screen.findByRole('heading', { level: 2, name: 'Research canceled' })).toBeInTheDocument()
  })

  it('shows a discarded run as read-only', async () => {
    mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'DISCARDED', reviewedAt: '2026-11-04T11:00:00Z' }))
    renderView()
    expect(await screen.findByRole('heading', { level: 2, name: 'Research discarded' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save selected' })).not.toBeInTheDocument()
  })

  it('shows a finished review with the avatars it produced, each linking to the library', async () => {
    const user = userEvent.setup()
    mockedApi.getResearchRun.mockResolvedValue(
      makeRun({
        status: 'REVIEWED',
        reviewedAt: '2026-11-04T11:00:00Z',
        savedAvatarIds: ['a1', 'a2'],
        savedDrafts: [
          { draftIndex: 0, avatarId: 'a1' },
          { draftIndex: 1, avatarId: 'a2' },
        ],
      }),
    )
    mockedApi.listAvatars.mockResolvedValue([
      { id: 'a1', name: 'The Plain-Gold Loyalist' } as api.BuyerAvatar,
      { id: 'a2', name: 'The Mother Passing It Forward' } as api.BuyerAvatar,
      { id: 'a3', name: 'Another' } as api.BuyerAvatar,
    ])
    const { onOpenAvatar } = renderView()
    expect(await screen.findByRole('heading', { level: 2, name: 'Research done' })).toBeInTheDocument()
    expect(screen.getByText(/You saved 2 avatars/)).toBeInTheDocument()
    // The names arrive after the heading (the library is loaded separately).
    const list = await screen.findByRole('list', { name: 'Avatars saved from this research' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'The Plain-Gold Loyalist',
      'The Mother Passing It Forward',
    ])
    await user.click(within(list).getByRole('link', { name: 'The Plain-Gold Loyalist' }))
    expect(onOpenAvatar).toHaveBeenCalledWith('a1')
    expect(screen.queryByRole('button', { name: 'Save selected' })).not.toBeInTheDocument()
  })

  describe('the research stays readable once the run is closed', () => {
    const done = () =>
      makeRun({
        status: 'REVIEWED',
        reviewedAt: '2026-11-04T11:00:00Z',
        savedAvatarIds: ['a1'],
        savedDrafts: [{ draftIndex: 0, avatarId: 'a1' }],
      })

    function expectNothingEditable() {
      for (const name of [/Save selected/, /Mark as done/, /^Discard$/, /Add term/, /Remove term/]) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      }
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    }

    it('shows a done run its evidence, problems, solutions, gaps and competitor terms', async () => {
      mockedApi.getResearchRun.mockResolvedValue(done())
      mockedApi.listAvatars.mockResolvedValue([{ id: 'a1', name: 'The Plain-Gold Loyalist' } as api.BuyerAvatar])
      renderView()
      await screen.findByRole('heading', { level: 2, name: 'Research done' })
      expect(screen.getByRole('heading', { level: 3, name: 'Evidence' })).toBeInTheDocument()
      expect(screen.getByText('Reached 12 of 14 linked pages.')).toBeInTheDocument()
      const problems = screen.getByRole('list', { name: 'Problems' })
      expect(within(problems).getAllByRole('listitem')).toHaveLength(2)
      expect(within(problems).getByText(/it turned my finger green in a month/)).toBeInTheDocument()
      expect(within(screen.getByRole('list', { name: 'Solutions' })).getAllByRole('listitem')).toHaveLength(2)
      expect(within(screen.getByRole('list', { name: 'Gaps' })).getByText(/Free resizing for life/)).toBeInTheDocument()
      const terms = screen.getByRole('list', { name: 'Competitor terms' })
      expect(within(terms).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Cartier'])
      expectNothingEditable()
    })

    it('marks each draft Saved (linking to the library) or Not saved', async () => {
      const user = userEvent.setup()
      mockedApi.getResearchRun.mockResolvedValue(done())
      mockedApi.listAvatars.mockResolvedValue([{ id: 'a1', name: 'The Plain-Gold Loyalist' } as api.BuyerAvatar])
      const { onOpenAvatar } = renderView()
      const drafts = await screen.findByRole('list', { name: 'Avatar drafts' })
      const saved = within(drafts).getByRole('listitem', { name: 'The Plain-Gold Loyalist' })
      expect(within(saved).getByText('Saved')).toBeInTheDocument()
      await user.click(within(saved).getByRole('link', { name: /View The Plain-Gold Loyalist in your library/ }))
      expect(onOpenAvatar).toHaveBeenCalledWith('a1')
      for (const name of ['The Mother Passing It Forward', 'The Heirloom Buyer']) {
        const item = within(drafts).getByRole('listitem', { name })
        expect(within(item).getByText('Not saved')).toBeInTheDocument()
        expect(within(item).queryByRole('link')).not.toBeInTheDocument()
      }
      // What the unsaved draft held is readable, not just its name.
      expect(within(drafts).getByText('The Mother Passing It Forward buys fine jewelry.')).toBeInTheDocument()
      expect(within(drafts).getAllByText('The Sanitizer Test').length).toBeGreaterThan(0)
    })

    it('shows a discarded run its research, every draft Not saved', async () => {
      mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'DISCARDED', reviewedAt: '2026-11-04T11:00:00Z' }))
      renderView()
      await screen.findByRole('heading', { level: 2, name: 'Research discarded' })
      expect(screen.getByRole('list', { name: 'Problems' })).toBeInTheDocument()
      expect(screen.getAllByText('Not saved')).toHaveLength(3)
      expectNothingEditable()
    })

    it('keeps a failed or canceled run as it was, with no research shown', async () => {
      mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'FAILED', error: 'It broke' }))
      const { unmount } = renderViewWithUnmount()
      await screen.findByRole('heading', { level: 2, name: 'Research failed' })
      expect(screen.queryByRole('list', { name: 'Problems' })).not.toBeInTheDocument()
      unmount()
      mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'CANCELED', stopReason: 'canceled' }))
      renderViewWithUnmount()
      await screen.findByRole('heading', { level: 2, name: 'Research canceled' })
      expect(screen.queryByRole('list', { name: 'Problems' })).not.toBeInTheDocument()
    })

    it('still reopens, and the editable review comes back', async () => {
      const user = userEvent.setup()
      const closed = done()
      mockedApi.getResearchRun
        .mockResolvedValueOnce(closed)
        .mockResolvedValue({ ...closed, status: 'NEEDS_REVIEW', reviewedAt: null })
      mockedApi.listAvatars.mockResolvedValue([{ id: 'a1', name: 'The Plain-Gold Loyalist' } as api.BuyerAvatar])
      mockedApi.reopenResearchRun.mockResolvedValue({ ...closed, status: 'NEEDS_REVIEW', reviewedAt: null })
      renderView()
      await user.click(await screen.findByRole('button', { name: 'Reopen to save more' }))
      expect(await screen.findByRole('heading', { level: 2, name: 'Review the research' })).toBeInTheDocument()
      expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    })
  })

  it('reopens a done run so more avatars can be saved', async () => {
    const user = userEvent.setup()
    const done = makeRun({
      status: 'REVIEWED',
      reviewedAt: '2026-11-04T11:00:00Z',
      savedAvatarIds: ['n1'],
      savedDrafts: [{ draftIndex: 0, avatarId: 'n1' }],
    })
    mockedApi.getResearchRun
      .mockResolvedValueOnce(done)
      .mockResolvedValue({ ...done, status: 'NEEDS_REVIEW', reviewedAt: null })
    mockedApi.listAvatars.mockResolvedValue([{ id: 'n1', name: 'The Plain-Gold Loyalist' } as api.BuyerAvatar])
    mockedApi.reopenResearchRun.mockResolvedValue({ ...done, status: 'NEEDS_REVIEW', reviewedAt: null })
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Reopen to save more' }))
    expect(mockedApi.reopenResearchRun).toHaveBeenCalledWith('biz-1', 'run-1')
    expect(await screen.findByRole('heading', { level: 2, name: 'Review the research' })).toBeInTheDocument()
    const saved = screen.getByRole('listitem', { name: 'The Plain-Gold Loyalist' })
    expect(within(saved).getByText('Saved')).toBeInTheDocument()
    expect(
      within(screen.getByRole('listitem', { name: 'The Heirloom Buyer' })).getByRole('checkbox', { name: /Save/ }),
    ).toBeEnabled()
  })

  it('shows why a run could not be reopened', async () => {
    const user = userEvent.setup()
    mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'REVIEWED', savedAvatarIds: [] }))
    mockedApi.reopenResearchRun.mockRejectedValue(new api.ApiError(409, 'Only a finished review can be reopened'))
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Reopen to save more' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a finished review can be reopened')
    expect(screen.getByRole('heading', { level: 2, name: 'Research done' })).toBeInTheDocument()
  })

  it('offers no reopen for a discarded run', async () => {
    mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'DISCARDED' }))
    renderView()
    await screen.findByRole('heading', { level: 2, name: 'Research discarded' })
    expect(screen.queryByRole('button', { name: 'Reopen to save more' })).not.toBeInTheDocument()
  })

  it('stays on the review after saving, now showing the saved avatar and the others to pick', async () => {
    const user = userEvent.setup()
    mockedApi.getResearchRun
      .mockResolvedValueOnce(makeRun())
      .mockResolvedValue(
        makeRun({ savedAvatarIds: ['n1'], savedDrafts: [{ draftIndex: 0, avatarId: 'n1' }] }),
      )
    mockedApi.listAvatars.mockResolvedValue([])
    mockedApi.bulkCreateAvatars.mockResolvedValue([{ id: 'n1', name: 'The Plain-Gold Loyalist' } as api.BuyerAvatar])
    const { onLibraryChanged } = renderView()
    await user.click(
      within(await screen.findByRole('listitem', { name: 'The Plain-Gold Loyalist' })).getByRole('checkbox', {
        name: /Save/,
      }),
    )
    mockedApi.listAvatars.mockResolvedValue([{ id: 'n1', name: 'The Plain-Gold Loyalist' } as api.BuyerAvatar])
    await user.click(screen.getByRole('button', { name: 'Save selected' }))
    await waitFor(() => expect(onLibraryChanged).toHaveBeenCalled())
    expect(screen.getByRole('heading', { level: 2, name: 'Review the research' })).toBeInTheDocument()
    const item = screen.getByRole('listitem', { name: 'The Plain-Gold Loyalist' })
    expect(within(item).getByText('Saved')).toBeInTheDocument()
    expect(
      within(screen.getByRole('listitem', { name: 'The Heirloom Buyer' })).getByRole('checkbox', { name: /Save/ }),
    ).toBeEnabled()
  })

  it('reopens an unfinished review that already has saved avatars', async () => {
    mockedApi.getResearchRun.mockResolvedValue(
      makeRun({ savedAvatarIds: ['n1'], savedDrafts: [{ draftIndex: 1, avatarId: 'n1' }] }),
    )
    mockedApi.listAvatars.mockResolvedValue([{ id: 'n1', name: 'The Mother Passing It Forward' } as api.BuyerAvatar])
    renderView()
    const item = await screen.findByRole('listitem', { name: 'The Mother Passing It Forward' })
    expect(within(item).getByText('Saved')).toBeInTheDocument()
  })

  it('finishes the review with Mark as done and shows the finished summary', async () => {
    const user = userEvent.setup()
    const open = makeRun({ savedAvatarIds: ['n1'], savedDrafts: [{ draftIndex: 0, avatarId: 'n1' }] })
    mockedApi.getResearchRun
      .mockResolvedValueOnce(open)
      .mockResolvedValue({ ...open, status: 'REVIEWED', reviewedAt: '2026-11-04T11:00:00Z' })
    mockedApi.listAvatars.mockResolvedValue([{ id: 'n1', name: 'The Plain-Gold Loyalist' } as api.BuyerAvatar])
    mockedApi.markResearchRunDone.mockResolvedValue({ ...open, status: 'REVIEWED' })
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Mark as done' }))
    await user.click(screen.getByRole('button', { name: 'Yes, mark as done' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Research done' })).toBeInTheDocument()
    expect(mockedApi.markResearchRunDone).toHaveBeenCalledWith('biz-1', 'run-1')
  })

  it('reloads after discarding', async () => {
    const user = userEvent.setup()
    mockedApi.getResearchRun
      .mockResolvedValueOnce(makeRun())
      .mockResolvedValue(makeRun({ status: 'DISCARDED' }))
    mockedApi.discardResearchRun.mockResolvedValue(makeRun({ status: 'DISCARDED' }))
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    await user.click(screen.getByRole('button', { name: 'Yes, discard' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Research discarded' })).toBeInTheDocument()
  })

  it('shows a run that cannot be loaded, and retries', async () => {
    const user = userEvent.setup()
    mockedApi.getResearchRun.mockRejectedValueOnce(new api.ApiError(404, 'Research run not found'))
    renderView('nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('Research run not found')
    mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'DISCARDED' }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Research discarded' })).toBeInTheDocument()
  })

  it('has a way back', async () => {
    const user = userEvent.setup()
    mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'FAILED', error: 'x' }))
    const { onBack } = renderView()
    await user.click(await screen.findByRole('button', { name: 'Back to avatars' }))
    expect(onBack).toHaveBeenCalled()
    await waitFor(() => expect(mockedApi.getResearchRun).toHaveBeenCalled())
  })
})
