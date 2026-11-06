import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchEntry } from './ResearchEntry'
import * as api from '../lib/api'
import { makeRun } from '../test/researchFixtures'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, listResearchRuns: vi.fn<typeof actual.listResearchRuns>() }
})
const mockedApi = vi.mocked(api)

beforeEach(() => vi.resetAllMocks())

function renderEntry() {
  const onOpen = vi.fn<(view: string) => void>()
  const { container } = render(<ResearchEntry businessId="biz-1" refreshKey={0} onOpen={onOpen} />)
  return { onOpen, container }
}

describe('ResearchEntry', () => {
  it('shows nothing while research is switched off (the server answers 404)', async () => {
    mockedApi.listResearchRuns.mockRejectedValue(new api.ApiError(404, 'Avatar research is not enabled'))
    const { container } = renderEntry()
    await vi.waitFor(() => expect(mockedApi.listResearchRuns).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it('does not vanish when the runs cannot be loaded: it says so and offers a retry', async () => {
    const user = userEvent.setup()
    mockedApi.listResearchRuns.mockRejectedValueOnce(new Error('network'))
    mockedApi.listResearchRuns.mockResolvedValue([makeRun({ id: 'r1', status: 'REVIEWED' })])
    const { container } = renderEntry()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your past research runs')
    expect(container).not.toBeEmptyDOMElement()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Past research runs' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a loading state while the runs load, not an empty gap', async () => {
    let resolve: (runs: api.ResearchRun[]) => void = () => undefined
    mockedApi.listResearchRuns.mockReturnValue(new Promise((r) => (resolve = r)))
    renderEntry()
    expect(screen.getByText('Loading past research runs…')).toBeInTheDocument()
    resolve([makeRun({ id: 'r1', status: 'REVIEWED' })])
    expect(await screen.findByRole('table', { name: 'Past research runs' })).toBeInTheDocument()
    expect(screen.queryByText('Loading past research runs…')).not.toBeInTheDocument()
  })

  it('keeps the list on screen while it reloads after coming back from a run', async () => {
    mockedApi.listResearchRuns.mockResolvedValue([makeRun({ id: 'r1', status: 'REVIEWED' })])
    const onOpen = vi.fn<(view: string) => void>()
    const { rerender } = render(<ResearchEntry businessId="biz-1" refreshKey={0} onOpen={onOpen} />)
    await screen.findByRole('table', { name: 'Past research runs' })
    mockedApi.listResearchRuns.mockReturnValue(new Promise(() => undefined))
    rerender(<ResearchEntry businessId="biz-1" refreshKey={1} onOpen={onOpen} />)
    expect(screen.getByRole('table', { name: 'Past research runs' })).toBeInTheDocument()
  })

  it('offers the Research avatars button when it is on, even with no runs yet', async () => {
    mockedApi.listResearchRuns.mockResolvedValue([])
    const { onOpen } = renderEntry()
    await userEvent.click(await screen.findByRole('button', { name: 'Research avatars (AI)' }))
    expect(onOpen).toHaveBeenCalledWith('new')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('lists past runs with status, date, depth, model and cost, newest first as given', async () => {
    mockedApi.listResearchRuns.mockResolvedValue([
      makeRun({ id: 'r2', status: 'NEEDS_REVIEW', depth: 'standard', costUsd: 1.49, createdAt: '2026-11-04T09:59:00Z' }),
      makeRun({ id: 'r1', status: 'FAILED', depth: 'light', model: 'claude-fable-5-1', costUsd: 0.96, createdAt: '2026-11-03T12:00:00Z' }),
    ])
    const { onOpen } = renderEntry()
    const table = await screen.findByRole('table', { name: 'Past research runs' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Ready to review')
    expect(rows[0]).toHaveTextContent('Standard')
    expect(rows[0]).toHaveTextContent('Claude Opus 5.5')
    expect(rows[0]).toHaveTextContent('$1.49')
    expect(rows[1]).toHaveTextContent('Failed')
    expect(rows[1]).toHaveTextContent('Claude Fable 5.1')
    expect(rows[1]).toHaveTextContent('Light')
    await userEvent.click(within(rows[0]).getByRole('button', { name: /Open/ }))
    expect(onOpen).toHaveBeenCalledWith('r2')
  })

  it('shows how many avatars were saved from each run, and when a run is still open', async () => {
    mockedApi.listResearchRuns.mockResolvedValue([
      makeRun({ id: 'r3', status: 'NEEDS_REVIEW', savedAvatarIds: ['a', 'b'] }),
      makeRun({ id: 'r2', status: 'REVIEWED', savedAvatarIds: ['c'] }),
      makeRun({ id: 'r1', status: 'DISCARDED', savedAvatarIds: [] }),
    ])
    renderEntry()
    const table = await screen.findByRole('table', { name: 'Past research runs' })
    expect(within(table).getByRole('columnheader', { name: 'Avatars saved' })).toBeInTheDocument()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('In review')
    expect(within(rows[0]).getAllByRole('cell')[2]).toHaveTextContent('2')
    expect(rows[1]).toHaveTextContent('Done')
    expect(within(rows[1]).getAllByRole('cell')[2]).toHaveTextContent('1')
    expect(rows[2]).toHaveTextContent('Discarded')
    expect(within(rows[2]).getAllByRole('cell')[2]).toHaveTextContent('0')
  })

  it('says a run is waiting for review and offers to open a running one', async () => {
    mockedApi.listResearchRuns.mockResolvedValue([makeRun({ id: 'r3', status: 'RUNNING' })])
    renderEntry()
    expect(await screen.findByText(/A research run is in progress/)).toBeInTheDocument()
  })

  it('shows an unknown model id as it is stored', async () => {
    mockedApi.listResearchRuns.mockResolvedValue([makeRun({ model: 'claude-future-9' })])
    renderEntry()
    expect(await screen.findByText('claude-future-9')).toBeInTheDocument()
  })
})
