import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// The server's expected cost per depth, for the model and products chosen.
const COSTS: Record<api.ResearchDepth, number> = { light: 0.9, standard: 1.32, deep: 2.54 }

function product(id: string, name: string | null, image: string | null = null): api.Product {
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
    primaryImageUrl: image,
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
    const depth = await screen.findByRole('group', { name: /Research depth/ })
    expect(within(depth).getByRole('radio', { name: /Standard/ })).toBeChecked()
    expect(within(depth).getByText(/A quick initial assessment/)).toBeInTheDocument()
    expect(within(depth).getByText(/An extensive investigation/)).toBeInTheDocument()
  })

  it('shows the cost, the runs left and the caps before starting', async () => {
    renderStart()
    expect(await screen.findByText(/about \$1\.32/)).toBeInTheDocument()
    expect(screen.getByText(/at most \$2\.09/)).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 research runs left this month/)).toBeInTheDocument()
  })

  it('switches the cost in the summary when the depth changes, without asking again', async () => {
    const user = userEvent.setup()
    mockedApi.estimateResearchRun.mockImplementation((_id, body) =>
      Promise.resolve(makeEstimate({ depth: body.depth, expectedUsd: COSTS[body.depth], maxUsd: COSTS[body.depth] * 1.6 })),
    )
    renderStart()
    await screen.findByText(/about \$1\.32/)
    mockedApi.estimateResearchRun.mockClear()
    await user.click(screen.getByRole('radio', { name: /Deep/ }))
    expect(await screen.findByText(/about \$2\.54/)).toBeInTheDocument()
    expect(mockedApi.estimateResearchRun).not.toHaveBeenCalled()
  })

  it('offers only the models the business may use, with Fable 5.1 shown as unavailable', async () => {
    renderStart()
    await estimateShown()
    const model = await screen.findByRole('group', { name: /AI research model/ })
    expect(within(model).getByRole('radio', { name: /Claude Opus 5\.5/ })).toBeEnabled()
    const fable = within(model).getByRole('radio', { name: /Fable 5\.1/ })
    expect(fable).toBeDisabled()
    expect(within(model).getByText(/This model is not enabled for this business\. Contact your administrator to request access\./)).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: /^Start Research/ }))
    expect(mockedApi.startResearchRun).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ model: 'claude-fable-5-1' }),
    )
  })

  it('selects the first three products and stops at three', async () => {
    const user = userEvent.setup()
    renderStart()
    const group = await screen.findByRole('group', { name: /Products to research/ })
    const boxes = within(group).getAllByRole('checkbox')
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, true, false])
    expect(boxes[3]).toBeDisabled()
    expect(within(group).getByText(/You've selected the maximum of three products/)).toBeInTheDocument()
    await user.click(boxes[0])
    expect(boxes[3]).toBeEnabled()
  })

  it('accepts up to five extra competitor URLs and rejects bad or extra ones', async () => {
    const user = userEvent.setup()
    renderStart()
    const field = await screen.findByLabelText(/Extra competitor web addresses/)
    await user.type(field, 'not a url')
    expect(await screen.findByText(/is not a full web address/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Start Research/ })).toBeDisabled()
    await user.clear(field)
    await user.type(
      field,
      ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `https://${x}.example.com`).join('{Enter}'),
    )
    expect(await screen.findByText(/At most 5/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Start Research/ })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: /^Research anyway/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Start Research/ })).not.toBeInTheDocument()
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
    await waitFor(() => expect(mockedApi.estimateResearchRun).toHaveBeenCalledWith('biz-1', expect.objectContaining({ depth: 'light' })))
    await user.click(await screen.findByRole('button', { name: /^Start Research/ }))
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
    await user.click(await screen.findByRole('button', { name: /^Start Research/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('blocks starting when the monthly runs are used up', async () => {
    mockedApi.estimateResearchRun.mockResolvedValue(makeEstimate({ runsRemaining: 0, runsUsed: 2 }))
    renderStart()
    expect(await screen.findByText(/0 of 2 research runs left this month/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Start Research/ })).toBeDisabled()
    expect(screen.getByText(/used all of this month's research runs/)).toBeInTheDocument()
  })

  it('blocks starting while a run is in progress and offers to view it', async () => {
    const user = userEvent.setup()
    const { onViewRun } = renderStart({ activeRunId: 'run-5' })
    expect(await screen.findByText(/already running/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Start Research/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'View progress' }))
    expect(onViewRun).toHaveBeenCalledWith('run-5')
  })

  it('shows a refusal from the estimate (model not allowed) and does not allow starting', async () => {
    mockedApi.estimateResearchRun.mockRejectedValue(
      new api.ApiError(403, 'This business is not allowed to use that model.'),
    )
    renderStart()
    expect(await screen.findByRole('alert')).toHaveTextContent('not allowed to use that model')
    expect(screen.getByRole('button', { name: /^Start Research/ })).toBeDisabled()
  })

  it('goes back', async () => {
    const user = userEvent.setup()
    const { onBack } = renderStart()
    await user.click(await screen.findByRole('button', { name: 'Back to avatars' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('moves focus to the heading', async () => {
    renderStart()
    const heading = await screen.findByRole('heading', { level: 2, name: 'Research Avatars' })
    await waitFor(() => expect(heading).toHaveFocus())
  })
})

describe('the redesigned selection cards', () => {
  it('shows depth as three cards with an icon-led title, a description and a short tag', async () => {
    renderStart()
    const depth = await screen.findByRole('group', { name: /1\. Research depth/ })
    expect(within(depth).getAllByRole('radio')).toHaveLength(3)
    expect(within(depth).getByText('Fastest')).toBeInTheDocument()
    expect(within(depth).getByText('Recommended')).toBeInTheDocument()
    expect(within(depth).getByText('Most comprehensive')).toBeInTheDocument()
    expect(within(depth).getByText(/A balanced investigation across customer discussions/)).toBeInTheDocument()
    // No claim about cost or time of its own: a figure appears only once the server has given one.
    expect(within(depth).queryByText(/cheapest|fastest to run|hours|minutes/i)).not.toBeInTheDocument()
  })

  it('selects a depth by clicking anywhere on its card, one at a time', async () => {
    const user = userEvent.setup()
    renderStart()
    const depth = await screen.findByRole('group', { name: /Research depth/ })
    await user.click(within(depth).getByText(/An extensive investigation/))
    expect(within(depth).getByRole('radio', { name: /Deep/ })).toBeChecked()
    expect(within(depth).getByRole('radio', { name: /Standard/ })).not.toBeChecked()
    expect(within(depth).getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1)
    expect(within(depth).getByRole('radio', { name: /Deep/ }).closest('label')).toHaveClass('is-selected')
    expect(within(depth).getByRole('radio', { name: /Standard/ }).closest('label')).not.toHaveClass('is-selected')
  })

  it('can be used with the keyboard', async () => {
    const user = userEvent.setup()
    renderStart()
    const depth = await screen.findByRole('group', { name: /Research depth/ })
    within(depth).getByRole('radio', { name: /Standard/ }).focus()
    await user.keyboard('{ArrowRight}')
    expect(within(depth).getByRole('radio', { name: /Deep/ })).toBeChecked()
  })

  it('shows the models as cards with a Standard or Premium status', async () => {
    renderStart()
    await estimateShown()
    const model = screen.getByRole('group', { name: /2\. AI research model/ })
    const opus = within(model).getByRole('radio', { name: /Claude Opus 5\.5/ })
    expect(opus).toBeChecked()
    expect(within(model).getByText('Standard')).toBeInTheDocument()
    expect(within(model).getByText('Premium')).toBeInTheDocument()
    expect(within(model).getByText(/The standard research model for analyzing customer behavior/)).toBeInTheDocument()
    expect(within(model).getByText(/Premium research model offering an advanced research option/)).toBeInTheDocument()
    // No invented prices or multipliers.
    expect(within(model).queryByText(/twice|\$|cheaper/i)).not.toBeInTheDocument()
  })

  it('never selects a model the business may not use, even by clicking its card', async () => {
    const user = userEvent.setup()
    renderStart()
    await estimateShown()
    const model = screen.getByRole('group', { name: /AI research model/ })
    const fable = within(model).getByRole('radio', { name: /Fable 5\.1/ })
    expect(fable).toBeDisabled()
    expect(fable.closest('label')).toHaveClass('is-disabled')
    expect(fable).toHaveAccessibleDescription(/not enabled for this business/)
    await user.click(within(model).getByText(/Premium research model offering/))
    expect(fable).not.toBeChecked()
    expect(within(model).getByRole('radio', { name: /Claude Opus 5\.5/ })).toBeChecked()
  })
})

describe('the product cards', () => {
  const photo = 'https://cdn.example.com/emerald.jpg'
  beforeEach(() => {
    mockedApi.listProducts.mockResolvedValue([
      product('p1', 'Emerald Coil', photo),
      product('p2', 'Triangle band'),
      product('p3', null),
      product('p4', 'Fourth'),
    ])
  })

  it('shows each product with its photo, real name and own description', async () => {
    renderStart()
    const group = await screen.findByRole('group', { name: /3\. Products to research/ })
    const emerald = within(group).getByRole('checkbox', { name: /Emerald Coil/ }).closest('label') as HTMLElement
    expect(within(emerald).getByText('Emerald Coil')).toBeInTheDocument()
    expect(within(emerald).getByText('Emerald Coil description')).toBeInTheDocument()
    const image = within(emerald).getByRole('img', { name: /Emerald Coil/ })
    expect(image).toHaveAttribute('src', photo)
  })

  it('shows a placeholder, not a broken image, for a product without a photo or whose photo fails', async () => {
    renderStart()
    const group = await screen.findByRole('group', { name: /Products to research/ })
    const triangle = within(group).getByRole('checkbox', { name: /Triangle band/ }).closest('label') as HTMLElement
    expect(within(triangle).queryByRole('img')).not.toBeInTheDocument()
    const emerald = within(group).getByRole('checkbox', { name: /Emerald Coil/ }).closest('label') as HTMLElement
    fireEvent.error(within(emerald).getByRole('img'))
    expect(within(emerald).queryByRole('img')).not.toBeInTheDocument()
  })

  it('calls an unnamed product Untitled Product and still shows its own description', async () => {
    renderStart()
    const group = await screen.findByRole('group', { name: /Products to research/ })
    const unnamed = within(group).getByRole('checkbox', { name: /Unnamed description/ }).closest('label') as HTMLElement
    expect(within(unnamed).getByText('Untitled Product')).toBeInTheDocument()
    expect(within(unnamed).getByText('Unnamed description')).toBeInTheDocument()
    // A named product is never called Untitled.
    expect(within(group).getAllByText('Untitled Product')).toHaveLength(1)
  })

  it('counts the selection and updates the count as products are chosen and removed', async () => {
    const user = userEvent.setup()
    renderStart()
    const group = await screen.findByRole('group', { name: /Products to research/ })
    expect(within(group).getByText('3 of 3 selected')).toBeInTheDocument()
    await user.click(within(group).getByRole('checkbox', { name: /Emerald Coil/ }))
    expect(within(group).getByText('2 of 3 selected')).toBeInTheDocument()
    await user.click(within(group).getByRole('checkbox', { name: /Triangle band/ }))
    await user.click(within(group).getByRole('checkbox', { name: /Unnamed description/ }))
    expect(within(group).getByText('0 of 3 selected')).toBeInTheDocument()
  })

  it('selects a product by clicking anywhere on its card', async () => {
    const user = userEvent.setup()
    renderStart()
    const group = await screen.findByRole('group', { name: /Products to research/ })
    await user.click(within(group).getByText('Fourth description')) // the 4th is not chosen and disabled
    expect(within(group).getByRole('checkbox', { name: /Fourth/ })).not.toBeChecked()
    await user.click(within(group).getByText('Triangle band description'))
    expect(within(group).getByRole('checkbox', { name: /Triangle band/ })).not.toBeChecked()
    await user.click(within(group).getByText('Fourth description'))
    expect(within(group).getByRole('checkbox', { name: /Fourth/ })).toBeChecked()
  })

  it('explains the limit at three, keeps chosen products removable and lifts it on removal', async () => {
    const user = userEvent.setup()
    renderStart()
    const group = await screen.findByRole('group', { name: /Products to research/ })
    expect(
      within(group).getByText("You've selected the maximum of three products. Remove a selection to choose another product."),
    ).toBeInTheDocument()
    const fourth = within(group).getByRole('checkbox', { name: /Fourth/ })
    expect(fourth).toBeDisabled()
    expect(fourth.closest('label')).toHaveClass('is-disabled')
    for (const name of [/Emerald Coil/, /Triangle band/, /Unnamed description/]) {
      expect(within(group).getByRole('checkbox', { name })).toBeEnabled()
    }
    await user.click(within(group).getByRole('checkbox', { name: /Emerald Coil/ }))
    expect(within(group).queryByText(/You've selected the maximum/)).not.toBeInTheDocument()
    expect(fourth).toBeEnabled()
  })
})

describe('the live research configuration summary', () => {
  function summary() {
    return screen.getByRole('region', { name: 'Your research configuration' })
  }

  beforeEach(() => {
    mockedApi.listProducts.mockResolvedValue([
      product('p1', 'Emerald Coil', 'https://cdn.example.com/emerald.jpg'),
      product('p2', 'Triangle band'),
      product('p3', null),
      product('p4', 'Fourth'),
    ])
  })

  it('shows the current depth, model and products', async () => {
    renderStart()
    await estimateShown()
    const panel = summary()
    expect(within(panel).getByText('Review your selections before starting research.')).toBeInTheDocument()
    expect(within(panel).getByText('Research depth').parentElement).toHaveTextContent('Standard')
    expect(within(panel).getByText('AI model').parentElement).toHaveTextContent('Claude Opus 5.5')
    expect(within(panel).getByText('AI model').parentElement).toHaveTextContent('Standard')
    expect(within(panel).getByText('3 selected')).toBeInTheDocument()
    const list = within(panel).getByRole('list', { name: 'Selected products' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Emerald Coil',
      'Triangle band',
      'Untitled Product',
    ])
  })

  it('updates at once when the depth, the model or the products change', async () => {
    const user = userEvent.setup()
    mockedApi.estimateResearchRun.mockResolvedValue(
      makeEstimate({ allowedModels: ['claude-opus-5-5', 'claude-fable-5-1'] }),
    )
    renderStart()
    await estimateShown()
    await user.click(screen.getByRole('radio', { name: /Deep/ }))
    expect(within(summary()).getByText('Research depth').parentElement).toHaveTextContent('Deep')
    await waitFor(() => expect(screen.getByRole('radio', { name: /Fable 5\.1/ })).toBeEnabled())
    await user.click(screen.getByRole('radio', { name: /Fable 5\.1/ }))
    expect(within(summary()).getByText('AI model').parentElement).toHaveTextContent('Claude Fable 5.1')
    expect(within(summary()).getByText('AI model').parentElement).toHaveTextContent('Premium')
    await user.click(screen.getByRole('checkbox', { name: /Emerald Coil/ }))
    expect(within(summary()).getByText('2 selected')).toBeInTheDocument()
    expect(within(summary()).queryByText('Emerald Coil')).not.toBeInTheDocument()
  })

  it('says what happens when no product is chosen, and does not block starting', async () => {
    const user = userEvent.setup()
    renderStart()
    await estimateShown()
    for (const name of [/Emerald Coil/, /Triangle band/, /Unnamed description/]) {
      await user.click(screen.getByRole('checkbox', { name }))
    }
    expect(within(summary()).getByText('None selected')).toBeInTheDocument()
    expect(within(summary()).getByText(/most recent campaigns/)).toBeInTheDocument()
    expect(within(summary()).getByRole('button', { name: /^Start Research/ })).toBeEnabled()
  })

  it('holds the cost, the runs left and the Start Research button', async () => {
    renderStart()
    await estimateShown()
    const panel = summary()
    expect(within(panel).getByText(/about \$1\.32/)).toBeInTheDocument()
    expect(within(panel).getByText(/1 of 2 research runs left this month/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /^Start Research/ })).toBeEnabled()
  })
})

describe('starting the research from the redesigned page', () => {
  it('shows progress and sends one request however often the button is pressed', async () => {
    const user = userEvent.setup()
    let finish: (run: api.ResearchRun) => void = () => undefined
    mockedApi.startResearchRun.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderStart()
    await estimateShown()
    const button = await screen.findByRole('button', { name: /^Start Research/ })
    await user.dblClick(button)
    expect(await screen.findByRole('button', { name: /Starting/ })).toBeDisabled()
    expect(mockedApi.startResearchRun).toHaveBeenCalledTimes(1)
    finish(makeRun({ id: 'run-9', status: 'QUEUED' }))
  })

  it('sends the chosen depth, model and product ids, and keeps the choices when it fails', async () => {
    const user = userEvent.setup()
    mockedApi.startResearchRun.mockRejectedValueOnce(new api.ApiError(503, 'Research is not configured'))
    renderStart()
    await estimateShown()
    await user.click(screen.getByRole('radio', { name: /Deep/ }))
    await user.click(screen.getByRole('checkbox', { name: /Triangle band/ }))
    await user.click(await screen.findByRole('button', { name: /^Start Research/ }))
    expect(mockedApi.startResearchRun).toHaveBeenCalledWith('biz-1', {
      depth: 'deep',
      model: 'claude-opus-5-5',
      productIds: ['p1', 'p3'],
      competitorUrls: [],
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Research is not configured')
    expect(screen.getByRole('radio', { name: /Deep/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Triangle band/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: /^Start Research/ })).toBeEnabled()
  })
})

describe('the expected cost on each depth card', () => {
  const byDepth = () =>
    mockedApi.estimateResearchRun.mockImplementation((_id, body) =>
      Promise.resolve(makeEstimate({ depth: body.depth, expectedUsd: COSTS[body.depth] })),
    )
  const group = () => screen.getByRole('group', { name: /Research depth/ })

  it('shows the server\'s expected cost for every depth so they can be compared', async () => {
    byDepth()
    renderStart()
    expect(await within(group()).findByText('Expected $0.90')).toBeInTheDocument()
    expect(within(group()).getByText('Expected $1.32')).toBeInTheDocument()
    expect(within(group()).getByText('Expected $2.54')).toBeInTheDocument()
    // Each card sits with its own depth.
    expect(within(group()).getByRole('radio', { name: /Light/ }).closest('label')).toHaveTextContent('Expected $0.90')
    expect(within(group()).getByRole('radio', { name: /Deep/ }).closest('label')).toHaveTextContent('Expected $2.54')
  })

  it('asks the server for each depth with the model and products chosen', async () => {
    byDepth()
    renderStart()
    await within(group()).findByText('Expected $2.54')
    for (const depth of ['light', 'standard', 'deep']) {
      expect(mockedApi.estimateResearchRun).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({ depth, model: 'claude-opus-5-5', productIds: ['p1', 'p2', 'p3'] }),
      )
    }
  })

  it('shows no figure before the server has answered', async () => {
    mockedApi.estimateResearchRun.mockReturnValue(new Promise(() => undefined))
    renderStart()
    await screen.findByRole('group', { name: /Research depth/ })
    expect(within(group()).queryByText(/Expected \$/)).not.toBeInTheDocument()
  })

  it('updates the figures when the products chosen change', async () => {
    const user = userEvent.setup()
    mockedApi.estimateResearchRun.mockImplementation((_id, body) =>
      Promise.resolve(
        makeEstimate({
          depth: body.depth,
          expectedUsd: COSTS[body.depth] * (body.productIds?.length ?? 0),
        }),
      ),
    )
    renderStart()
    expect(await within(group()).findByText('Expected $7.62')).toBeInTheDocument() // deep, 3 products
    await user.click(screen.getByRole('checkbox', { name: /Triangle band/ }))
    expect(await within(group()).findByText('Expected $5.08')).toBeInTheDocument() // deep, 2 products
    expect(within(group()).queryByText('Expected $7.62')).not.toBeInTheDocument()
  })

  it('leaves a depth without a figure when only its estimate fails', async () => {
    mockedApi.estimateResearchRun.mockImplementation((_id, body) =>
      body.depth === 'light'
        ? Promise.reject(new api.ApiError(500, 'boom'))
        : Promise.resolve(makeEstimate({ depth: body.depth, expectedUsd: COSTS[body.depth] })),
    )
    renderStart()
    expect(await within(group()).findByText('Expected $2.54')).toBeInTheDocument()
    expect(within(group()).getByRole('radio', { name: /Light/ }).closest('label')).not.toHaveTextContent('$')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // the chosen depth is fine
  })

  it('names the problem and shows no figures when the chosen depth cannot be estimated', async () => {
    mockedApi.estimateResearchRun.mockRejectedValue(new api.ApiError(403, 'This business is not allowed to use that model.'))
    renderStart()
    expect(await screen.findByRole('alert')).toHaveTextContent('not allowed to use that model')
    expect(within(group()).queryByText(/Expected \$/)).not.toBeInTheDocument()
  })
})
