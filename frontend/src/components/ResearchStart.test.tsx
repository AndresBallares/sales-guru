import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchStart } from './ResearchStart'
import * as api from '../lib/api'
import { makeEstimate, makeRun } from '../test/researchFixtures'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    listProducts: vi.fn<typeof actual.listProducts>(),
    estimateResearchRun: vi.fn<typeof actual.estimateResearchRun>(),
    startResearchRun: vi.fn<typeof actual.startResearchRun>(),
  }
})
const mockedApi = vi.mocked(api)

function product(id: string, name: string | null): api.Product {
  return {
    id,
    description: `${name ?? 'Unnamed'} description`,
    name,
    price: null,
    margin: null,
    features: null,
    benefits: null,
    mechanism: null,
    url: null,
    primaryImageUrl: null,
  }
}

async function estimateShown() {
  await screen.findByText(/research runs left this month/)
}

function renderStart(props: Partial<React.ComponentProps<typeof ResearchStart>> = {}) {
  const onStarted = vi.fn<(run: api.ResearchRun) => void>()
  const onBack = vi.fn<() => void>()
  const onViewRun = vi.fn<(id: string) => void>()
  render(
    <MemoryRouter>
      <ResearchStart
        businessId="biz-1"
        activeRunId={null}
        onStarted={onStarted}
        onBack={onBack}
        onViewRun={onViewRun}
        {...props}
      />
    </MemoryRouter>,
  )
  return { onStarted, onBack, onViewRun }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.listProducts.mockResolvedValue([
    product('p1', 'Emerald Coil'),
    product('p2', 'Triangle band'),
    product('p3', null),
    product('p4', 'Fourth'),
  ])
  mockedApi.estimateResearchRun.mockResolvedValue(makeEstimate())
  mockedApi.startResearchRun.mockResolvedValue(makeRun({ id: 'run-9', status: 'QUEUED' }))
})

describe('ResearchStart', () => {
  it('explains each depth in plain words and defaults to standard', async () => {
    renderStart()
    const depth = await screen.findByRole('group', { name: 'Depth' })
    expect(within(depth).getByRole('radio', { name: /Standard/ })).toBeChecked()
    expect(within(depth).getByText(/A quick pass/)).toBeInTheDocument()
    expect(within(depth).getByText(/The most sources/)).toBeInTheDocument()
  })

  it('shows the cost, the runs left and the caps before starting', async () => {
    renderStart()
    expect(await screen.findByText(/about \$1\.32/)).toBeInTheDocument()
    expect(screen.getByText(/at most \$2\.09/)).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 research runs left this month/)).toBeInTheDocument()
  })

  it('asks for a new estimate when the depth changes', async () => {
    const user = userEvent.setup()
    renderStart()
    await screen.findByText(/about \$1\.32/)
    mockedApi.estimateResearchRun.mockResolvedValue(makeEstimate({ depth: 'deep', expectedUsd: 2.54, maxUsd: 4.78 }))
    await user.click(screen.getByRole('radio', { name: /Deep/ }))
    expect(await screen.findByText(/about \$2\.54/)).toBeInTheDocument()
    expect(mockedApi.estimateResearchRun).toHaveBeenLastCalledWith(
      'biz-1',
      expect.objectContaining({ depth: 'deep', model: 'claude-opus-5-5' }),
    )
  })

  it('offers only the models the business may use, with Fable 5.1 shown as unavailable', async () => {
    renderStart()
    await estimateShown()
    const model = await screen.findByRole('group', { name: 'Model' })
    expect(within(model).getByRole('radio', { name: /Claude Opus 5\.5/ })).toBeEnabled()
    const fable = within(model).getByRole('radio', { name: /Fable 5\.1/ })
    expect(fable).toBeDisabled()
    expect(within(model).getByText(/Not turned on for this business/)).toBeInTheDocument()
  })

  it('lets a business with Fable enabled pick it and sends that model', async () => {
    const user = userEvent.setup()
    mockedApi.estimateResearchRun.mockResolvedValue(
      makeEstimate({ allowedModels: ['claude-opus-5-5', 'claude-fable-5-1'] }),
    )
    renderStart()
    const fable = await screen.findByRole('radio', { name: /Fable 5\.1/ })
    await waitFor(() => expect(fable).toBeEnabled())
    await user.click(fable)
    await waitFor(() =>
      expect(mockedApi.estimateResearchRun).toHaveBeenLastCalledWith(
        'biz-1',
        expect.objectContaining({ model: 'claude-fable-5-1' }),
      ),
    )
    await user.click(await screen.findByRole('button', { name: 'Start research' }))
    expect(mockedApi.startResearchRun).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ model: 'claude-fable-5-1' }),
    )
  })

  it('selects the first three products and stops at three', async () => {
    const user = userEvent.setup()
    renderStart()
    const group = await screen.findByRole('group', { name: 'Products to research' })
    const boxes = within(group).getAllByRole('checkbox')
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, true, false])
    expect(boxes[3]).toBeDisabled()
    await user.click(boxes[0])
    expect(boxes[3]).toBeEnabled()
  })

  it('accepts up to five extra competitor URLs and rejects bad or extra ones', async () => {
    const user = userEvent.setup()
    renderStart()
    const field = await screen.findByLabelText(/Extra competitor web addresses/)
    await user.type(field, 'not a url')
    expect(await screen.findByText(/is not a full web address/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start research' })).toBeDisabled()
    await user.clear(field)
    await user.type(
      field,
      ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `https://${x}.example.com`).join('{Enter}'),
    )
    expect(await screen.findByText(/At most 5/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start research' })).toBeDisabled()
  })

  it('names what is empty, why it matters and where to fill it in', async () => {
    mockedApi.estimateResearchRun.mockResolvedValue(
      makeEstimate({
        readiness: [
          { field: 'key_messages', label: 'Key messages', empty: true },
          { field: 'customer_problems', label: 'Customer problems', empty: false },
          { field: 'competitors', label: 'Competitors', empty: false },
          { field: 'product_names', label: 'Product names', empty: true },
          { field: 'product_descriptions', label: 'Product descriptions', empty: false },
        ],
      }),
    )
    renderStart()
    await estimateShown()
    const region = await screen.findByRole('region', { name: 'Before you start' })
    expect(within(region).getByText('Key messages')).toBeInTheDocument()
    expect(within(region).getByText('Product names')).toBeInTheDocument()
    expect(within(region).queryByText('Competitors')).not.toBeInTheDocument()
    expect(within(region).getByRole('link', { name: /brand profile/i })).toHaveAttribute('href', '/')
    expect(within(region).getByRole('link', { name: /Products tab/i })).toHaveAttribute(
      'href',
      '#products',
    )
    expect(screen.getByRole('button', { name: 'Research anyway' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Start research' })).not.toBeInTheDocument()
  })

  it('says everything is in place when nothing is empty', async () => {
    renderStart()
    expect(await screen.findByText(/Everything the research reads is filled in/)).toBeInTheDocument()
  })

  it('starts a run with the chosen settings and reports it', async () => {
    const user = userEvent.setup()
    const { onStarted } = renderStart()
    await user.type(await screen.findByLabelText(/Extra competitor web addresses/), 'https://rival.example.com')
    await estimateShown()
    await user.click(await screen.findByRole('radio', { name: /Light/ }))
    await estimateShown()
    await waitFor(() => expect(mockedApi.estimateResearchRun).toHaveBeenLastCalledWith('biz-1', expect.objectContaining({ depth: 'light' })))
    await user.click(await screen.findByRole('button', { name: 'Start research' }))
    expect(mockedApi.startResearchRun).toHaveBeenCalledWith('biz-1', {
      depth: 'light',
      model: 'claude-opus-5-5',
      productIds: ['p1', 'p2', 'p3'],
      competitorUrls: ['https://rival.example.com'],
    })
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-9' })))
  })

  it.each([
    [409, 'A research run is already in progress for this business.'],
    [429, 'This business has used its research runs for the month.'],
    [403, 'This business is not allowed to use that model.'],
    [503, 'Research is not configured: ANTHROPIC_API_KEY is not set.'],
  ])('shows the server message for a %s refusal', async (status, text) => {
    const user = userEvent.setup()
    mockedApi.startResearchRun.mockRejectedValue(new api.ApiError(status, text))
    const { onStarted } = renderStart()
    await estimateShown()
    await user.click(await screen.findByRole('button', { name: 'Start research' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('blocks starting when the monthly runs are used up', async () => {
    mockedApi.estimateResearchRun.mockResolvedValue(makeEstimate({ runsRemaining: 0, runsUsed: 2 }))
    renderStart()
    expect(await screen.findByText(/0 of 2 research runs left this month/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start research' })).toBeDisabled()
    expect(screen.getByText(/used all of this month's research runs/)).toBeInTheDocument()
  })

  it('blocks starting while a run is in progress and offers to view it', async () => {
    const user = userEvent.setup()
    const { onViewRun } = renderStart({ activeRunId: 'run-5' })
    expect(await screen.findByText(/already running/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start research' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'View progress' }))
    expect(onViewRun).toHaveBeenCalledWith('run-5')
  })

  it('shows a refusal from the estimate (model not allowed) and does not allow starting', async () => {
    mockedApi.estimateResearchRun.mockRejectedValue(
      new api.ApiError(403, 'This business is not allowed to use that model.'),
    )
    renderStart()
    expect(await screen.findByRole('alert')).toHaveTextContent('not allowed to use that model')
    expect(screen.getByRole('button', { name: 'Start research' })).toBeDisabled()
  })

  it('goes back', async () => {
    const user = userEvent.setup()
    const { onBack } = renderStart()
    await user.click(await screen.findByRole('button', { name: 'Back to avatars' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('moves focus to the heading', async () => {
    renderStart()
    const heading = await screen.findByRole('heading', { level: 2, name: 'Research avatars' })
    await waitFor(() => expect(heading).toHaveFocus())
  })
})
