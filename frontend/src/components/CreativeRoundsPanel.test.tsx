import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreativeRoundsPanel } from './CreativeRoundsPanel'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    listRounds: vi.fn<typeof actual.listRounds>(),
    createRound: vi.fn<typeof actual.createRound>(),
    deleteRound: vi.fn<typeof actual.deleteRound>(),
    setRoundCreativeSelected: vi.fn<typeof actual.setRoundCreativeSelected>(),
    publishRound: vi.fn<typeof actual.publishRound>(),
    getPublishStatus: vi.fn<typeof actual.getPublishStatus>(),
  }
})
const mockedApi = vi.mocked(api)

function makeCreative(id: string, overrides: Partial<api.Creative> = {}): api.Creative {
  return {
    id,
    campaignId: 'camp-1',
    roundId: 'round-2',
    adId: null,
    headline: `Headline ${id}`,
    bodyText: `Body ${id}`,
    description: '',
    cta: 'SHOP_NOW',
    creativeAngle: null,
    imagePrompt: null,
    videoPrompt: null,
    imageUrl: null,
    format: 'SINGLE_IMAGE',
    cards: [],
    status: 'GENERATED',
    createdAt: '2026-10-30T00:00:00Z',
    isStale: false,
    ...overrides,
  }
}

function makeRound(overrides: Partial<api.CreativeRound> = {}): api.CreativeRound {
  return {
    id: 'round-2',
    campaignId: 'camp-1',
    number: 2,
    status: 'OPEN',
    generatedCount: 2,
    selectedCount: 0,
    angles: [
      {
        avatar: 'gift_buyer',
        concept: 'anniversary-surprise',
        pillar: 'emotion',
        description: 'The reveal moment.',
      },
    ],
    creatives: [makeCreative('a'), makeCreative('b', { imageUrl: '/img/b.jpg' })],
    createdAt: '2026-10-30T00:00:00Z',
    ...overrides,
  }
}

function renderPanel(...args: [] | [api.Campaign['budgetLevel']]) {
  // No argument means a campaign that owns its budget; an explicit undefined is
  // a campaign response that does not say.
  const budgetLevel = args.length === 0 ? 'CAMPAIGN' : args[0]
  render(
    <CreativeRoundsPanel
      businessId="biz-1"
      campaignId="camp-1"
      budgetLevel={budgetLevel}
      pollMs={1}
    />,
  )
}

describe('CreativeRoundsPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedApi.listRounds.mockResolvedValue([])
  })

  it('offers a new round to a campaign that owns its budget', async () => {
    renderPanel()
    const add = await screen.findByRole('button', { name: 'Add new round' })
    await waitFor(() => expect(add).toBeEnabled())
    expect(screen.queryByText(/published before campaigns had one budget/i)).not.toBeInTheDocument()
  })

  it('explains why a campaign published before campaign budgets gets no new round', async () => {
    renderPanel('AD_SET')
    expect(await screen.findByText(/published before campaigns had one budget/i)).toBeVisible()
    expect(screen.getByText(/start a new creative test/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add new round' })).not.toBeInTheDocument()
  })

  it('treats an unknown budget level like the older case', async () => {
    renderPanel(undefined)
    expect(await screen.findByText(/published before campaigns had one budget/i)).toBeVisible()
  })

  it('generates a round and shows it', async () => {
    mockedApi.createRound.mockResolvedValue(makeRound())
    mockedApi.listRounds.mockResolvedValueOnce([]).mockResolvedValue([makeRound()])
    renderPanel()
    const add = await screen.findByRole('button', { name: 'Add new round' })
    await waitFor(() => expect(add).toBeEnabled())

    await userEvent.click(add)

    expect(mockedApi.createRound).toHaveBeenCalledWith('biz-1', 'camp-1')
    const round = await screen.findByRole('article', { name: 'Round 2' })
    expect(within(round).getByText('Open')).toBeVisible()
    expect(within(round).getByText(/Gift buyer – Anniversary surprise – Emotion/)).toBeVisible()
    expect(within(round).getByText('Headline a')).toBeVisible()
    // Only the ad with an image shows one.
    expect(round.querySelectorAll('img')).toHaveLength(1)
  })

  it('allows only one open round at a time', async () => {
    mockedApi.listRounds.mockResolvedValue([makeRound()])
    renderPanel()
    await screen.findByRole('article', { name: 'Round 2' })
    expect(screen.getByRole('button', { name: 'Add new round' })).toBeDisabled()
    expect(screen.getByText(/publish or delete the open round/i)).toBeVisible()
  })

  it('selects and removes an ad', async () => {
    const selected = makeRound({
      creatives: [makeCreative('a', { status: 'SELECTED' }), makeCreative('b')],
    })
    mockedApi.listRounds.mockResolvedValueOnce([makeRound()]).mockResolvedValue([selected])
    mockedApi.setRoundCreativeSelected.mockResolvedValue(selected)
    renderPanel()
    const first = (await screen.findAllByRole('button', { name: 'Select this ad' }))[0]

    await userEvent.click(first)

    expect(mockedApi.setRoundCreativeSelected).toHaveBeenCalledWith(
      'biz-1',
      'camp-1',
      'round-2',
      'a',
      true,
    )
    const remove = await screen.findByRole('button', { name: 'Remove from selection' })
    expect(remove).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(remove)

    expect(mockedApi.setRoundCreativeSelected).toHaveBeenLastCalledWith(
      'biz-1',
      'camp-1',
      'round-2',
      'a',
      false,
    )
  })

  it('cannot publish until an ad is selected', async () => {
    mockedApi.listRounds.mockResolvedValue([makeRound()])
    renderPanel()
    const publish = await screen.findByRole('button', { name: /publish 0 ads as pack 2/i })
    expect(publish).toBeDisabled()
  })

  it('publishes the selected ads as a pack, paused when asked', async () => {
    const open = makeRound({
      creatives: [makeCreative('a', { status: 'SELECTED' }), makeCreative('b')],
    })
    const closed = makeRound({ ...open, status: 'CLOSED' })
    mockedApi.listRounds.mockResolvedValueOnce([open]).mockResolvedValue([closed])
    mockedApi.publishRound.mockResolvedValue(closed)
    mockedApi.getPublishStatus.mockResolvedValue({ state: 'IDLE' })
    renderPanel()
    await userEvent.click(await screen.findByLabelText('Publish paused'))

    await userEvent.click(screen.getByRole('button', { name: 'Publish 1 ad as Pack 2' }))

    expect(mockedApi.publishRound).toHaveBeenCalledWith('biz-1', 'camp-1', 'round-2', {
      paused: true,
    })
    expect(await screen.findByText('Published as Pack 2')).toBeVisible()
    expect(screen.getByText('Live')).toBeVisible()
    expect(screen.queryByRole('button', { name: /^publish/i })).not.toBeInTheDocument()
  })

  it('shows the progress of a video round published in the background', async () => {
    const open = makeRound({ creatives: [makeCreative('a', { status: 'SELECTED' })] })
    const closed = makeRound({ ...open, status: 'CLOSED' })
    mockedApi.listRounds.mockResolvedValueOnce([open]).mockResolvedValue([closed])
    mockedApi.publishRound.mockResolvedValue(open)
    mockedApi.getPublishStatus
      .mockResolvedValueOnce({ state: 'PROCESSING', step: 'Processing video', progress: 40 })
      .mockResolvedValueOnce({ state: 'PROCESSING', step: 'Uploading video' })
      .mockResolvedValue({ state: 'DONE' })
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /publish 1 ad/i }))

    expect(await screen.findByText('Published as Pack 2')).toBeVisible()
    expect(mockedApi.getPublishStatus).toHaveBeenCalledTimes(3)
  })

  it('reports a background publish that failed and keeps the round open', async () => {
    const open = makeRound({ creatives: [makeCreative('a', { status: 'SELECTED' })] })
    mockedApi.listRounds.mockResolvedValue([open])
    mockedApi.publishRound.mockResolvedValue(open)
    mockedApi.getPublishStatus.mockResolvedValue({ state: 'FAILED', error: 'Video rejected' })
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /publish 1 ad/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Video rejected')
    expect(screen.getByRole('button', { name: /publish 1 ad/i })).toBeEnabled()
  })

  it('falls back to a generic message when a failed publish gives no reason', async () => {
    const open = makeRound({ creatives: [makeCreative('a', { status: 'SELECTED' })] })
    mockedApi.listRounds.mockResolvedValue([open])
    mockedApi.publishRound.mockResolvedValue(open)
    mockedApi.getPublishStatus.mockResolvedValue({ state: 'FAILED' })
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /publish 1 ad/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be published')
  })

  it('shows the error when publishing is refused', async () => {
    const open = makeRound({ creatives: [makeCreative('a', { status: 'SELECTED' })] })
    mockedApi.listRounds.mockResolvedValue([open])
    mockedApi.publishRound.mockRejectedValue(new api.ApiError(400, 'Add a Pixel first'))
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /publish 1 ad/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Add a Pixel first')
  })

  it('deletes an open round', async () => {
    mockedApi.listRounds.mockResolvedValueOnce([makeRound()]).mockResolvedValue([])
    mockedApi.deleteRound.mockResolvedValue()
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete round' }))

    expect(mockedApi.deleteRound).toHaveBeenCalledWith('biz-1', 'camp-1', 'round-2')
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
  })

  it('shows an error when the rounds cannot be loaded', async () => {
    mockedApi.listRounds.mockRejectedValue(new api.ApiError(500, 'Server down'))
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('Server down')
  })

  it('uses a generic message for an unexpected failure', async () => {
    mockedApi.listRounds.mockRejectedValue('boom')
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the rounds')
  })

  it('shows an error when generating a round fails', async () => {
    mockedApi.createRound.mockRejectedValue(new api.ApiError(409, 'A round is already open'))
    renderPanel()
    const add = await screen.findByRole('button', { name: 'Add new round' })
    await waitFor(() => expect(add).toBeEnabled())

    await userEvent.click(add)

    expect(await screen.findByRole('alert')).toHaveTextContent('A round is already open')
  })

  it('keeps the angle list readable for an older angle without an avatar', async () => {
    mockedApi.listRounds.mockResolvedValue([
      makeRound({
        angles: [{ avatar: null, concept: 'craftsmanship', pillar: null, description: '' }],
      }),
    ])
    renderPanel()
    expect(await screen.findByText('Craftsmanship')).toBeVisible()
  })
})
