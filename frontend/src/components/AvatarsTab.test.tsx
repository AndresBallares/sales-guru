import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarsTab } from './AvatarsTab'
import * as api from '../lib/api'
import { makeEstimate, makeRun } from '../test/researchFixtures'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    listAvatars: vi.fn<typeof actual.listAvatars>(),
    listResearchRuns: vi.fn<typeof actual.listResearchRuns>(),
    getResearchRun: vi.fn<typeof actual.getResearchRun>(),
    listProducts: vi.fn<typeof actual.listProducts>(),
    estimateResearchRun: vi.fn<typeof actual.estimateResearchRun>(),
  }
})
const mockedApi = vi.mocked(api)

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</p>
}

function renderTab(entry = '/businesses/biz-1#avatars') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AvatarsTab businessId="biz-1" />
      <Where />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.listAvatars.mockResolvedValue([])
  mockedApi.listResearchRuns.mockResolvedValue([])
  mockedApi.listProducts.mockResolvedValue([])
  mockedApi.estimateResearchRun.mockResolvedValue(makeEstimate())
})

describe('AvatarsTab', () => {
  it('shows the avatar library and no research button while research is off', async () => {
    mockedApi.listResearchRuns.mockRejectedValue(new api.ApiError(404, 'off'))
    renderTab()
    expect(await screen.findByRole('heading', { level: 2, name: 'Buyer avatars' })).toBeInTheDocument()
    await vi.waitFor(() => expect(mockedApi.listResearchRuns).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Research avatars' })).not.toBeInTheDocument()
  })

  describe('the past research runs section', () => {
    const runs = () => [
      makeRun({ id: 'run-2', status: 'REVIEWED', savedAvatarIds: ['a1'], createdAt: '2026-11-04T16:00:00Z' }),
      makeRun({ id: 'run-1', status: 'DISCARDED', createdAt: '2026-11-03T12:00:00Z' }),
    ]

    it('is shown at the bottom of the Avatars tab, after the library', async () => {
      mockedApi.listResearchRuns.mockResolvedValue(runs())
      renderTab('/businesses/biz-1?metaLater=1#avatars')
      const library = await screen.findByRole('heading', { level: 2, name: 'Buyer avatars' })
      const table = await screen.findByRole('table', { name: 'Past research runs' })
      expect(library.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.getAllByRole('button', { name: /^Open run from/ })).toHaveLength(2)
    })

    it('is still there when the library is empty and when there are no runs yet', async () => {
      mockedApi.listResearchRuns.mockResolvedValue([])
      renderTab('/businesses/biz-1?metaLater=1#avatars')
      expect(await screen.findByRole('button', { name: 'Research avatars' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 3, name: 'Research new avatars' })).toBeInTheDocument()
    })

    it('opens a run with its Open button, keeping the other address parts', async () => {
      const user = userEvent.setup()
      mockedApi.listResearchRuns.mockResolvedValue(runs())
      mockedApi.getResearchRun.mockResolvedValue(runs()[0])
      renderTab('/businesses/biz-1?metaLater=1#avatars')
      const table = await screen.findByRole('table', { name: 'Past research runs' })
      await user.click(within(table).getAllByRole('button', { name: /^Open run from/ })[0])
      expect(await screen.findByRole('heading', { level: 2, name: 'Research done' })).toBeInTheDocument()
      expect(screen.getByTestId('where')).toHaveTextContent('/businesses/biz-1?metaLater=1&research=run-2#avatars')
    })

    it('comes back after the run is closed', async () => {
      const user = userEvent.setup()
      mockedApi.listResearchRuns.mockResolvedValue(runs())
      mockedApi.getResearchRun.mockResolvedValue(runs()[1])
      renderTab('/businesses/biz-1?research=run-1#avatars')
      await user.click(await screen.findByRole('button', { name: 'Back to avatars' }))
      expect(await screen.findByRole('table', { name: 'Past research runs' })).toBeInTheDocument()
    })

    it('does not disappear when the runs fail to load', async () => {
      mockedApi.listResearchRuns.mockRejectedValue(new Error('network'))
      renderTab('/businesses/biz-1?metaLater=1#avatars')
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your past research runs')
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    })
  })

  it('opens the start screen from the button, keeping the tab in the address', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(await screen.findByRole('button', { name: 'Research avatars' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Research avatars' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/businesses/biz-1?research=new#avatars')
  })

  it('opens the start screen straight from the address (a refresh keeps the view)', async () => {
    renderTab('/businesses/biz-1?research=new#avatars')
    expect(await screen.findByRole('heading', { level: 2, name: 'Research avatars' })).toBeInTheDocument()
  })

  it('opens a run from the address and goes back to the library', async () => {
    const user = userEvent.setup()
    mockedApi.getResearchRun.mockResolvedValue(makeRun({ status: 'DISCARDED' }))
    renderTab('/businesses/biz-1?research=run-1#avatars')
    expect(await screen.findByRole('heading', { level: 2, name: 'Research discarded' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to avatars' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Buyer avatars' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/businesses/biz-1#avatars')
  })

  it('opens the library with an avatar picked out from a link in a finished run', async () => {
    const user = userEvent.setup()
    Element.prototype.scrollIntoView = vi.fn<() => void>()
    mockedApi.getResearchRun.mockResolvedValue(
      makeRun({
        status: 'REVIEWED',
        savedAvatarIds: ['a1'],
        savedDrafts: [{ draftIndex: 0, avatarId: 'a1' }],
      }),
    )
    mockedApi.listAvatars.mockResolvedValue([
      { id: 'a1', businessId: 'biz-1', name: 'The Plain-Gold Loyalist', who: 'w', purchaseFor: 'self',
        primaryProblems: [], unknownProblems: [], mechanisms: [], alternatives: [], objections: [],
        hooks: [], creativeAngles: [], concepts: [], isActive: true, sortOrder: 0, deletedAt: null },
    ])
    renderTab('/businesses/biz-1?research=run-1#avatars')
    await user.click(await screen.findByRole('link', { name: 'The Plain-Gold Loyalist' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Buyer avatars' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/businesses/biz-1?avatar=a1#avatars')
    await vi.waitFor(() =>
      expect(screen.getByRole('listitem', { name: /^The Plain-Gold Loyalist/ })).toHaveFocus(),
    )
  })

  it('moves to the run after one is started', async () => {
    const user = userEvent.setup()
    mockedApi.listResearchRuns.mockResolvedValue([])
    renderTab('/businesses/biz-1?research=new#avatars')
    await screen.findByText(/research runs left this month/)
    const started = makeRun({ id: 'run-9', status: 'QUEUED', phase: null, startedAt: null, finishedAt: null })
    vi.spyOn(api, 'startResearchRun').mockResolvedValue(started)
    mockedApi.getResearchRun.mockResolvedValue(started)
    await user.click(await screen.findByRole('button', { name: 'Start research' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Research in progress' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('?research=run-9#avatars')
  })

  it('tells the start screen when a run is already going', async () => {
    mockedApi.listResearchRuns.mockResolvedValue([makeRun({ id: 'run-5', status: 'RUNNING' })])
    renderTab('/businesses/biz-1?research=new#avatars')
    expect(await screen.findByText(/already running/)).toBeInTheDocument()
  })
})
