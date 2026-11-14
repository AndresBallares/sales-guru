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
    offerRoundPauses: vi.fn<typeof actual.offerRoundPauses>(),
    getPublishStatus: vi.fn<typeof actual.getPublishStatus>(),
    getRoundsOverview: vi.fn<typeof actual.getRoundsOverview>(),
    endRoundEarly: vi.fn<typeof actual.endRoundEarly>(),
    getRoundLaunchSummary: vi.fn<typeof actual.getRoundLaunchSummary>(),
    chooseRoundWinners: vi.fn<typeof actual.chooseRoundWinners>(),
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

const SHARED_BUDGET_MESSAGE = /uses a shared campaign budget, and new rounds can no longer be added/i

function renderPanel(roundsBudget?: 'CAMPAIGN' | 'AD_SET') {
  render(
    <CreativeRoundsPanel
      businessId="biz-1"
      campaignId="camp-1"
      roundsBudget={roundsBudget}
      pollMs={1}
    />,
  )
}

describe('CreativeRoundsPanel on a campaign with a shared budget', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedApi.listRounds.mockResolvedValue([])
  })

  it.each([['CAMPAIGN' as const], [undefined]])(
    'explains that no new round can be added, for roundsBudget %s',
    async (roundsBudget) => {
      renderPanel(roundsBudget)

      expect(await screen.findByText(SHARED_BUDGET_MESSAGE)).toBeVisible()
      expect(screen.getByText(/start a new campaign to run more rounds/i)).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Add new round' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'See which ads to pause' }),
      ).not.toBeInTheDocument()
      expect(mockedApi.getRoundsOverview).not.toHaveBeenCalled()
    },
  )

  it('lets an open round on such a campaign be deleted, and offers nothing to publish it', async () => {
    mockedApi.listRounds.mockResolvedValueOnce([makeRound()]).mockResolvedValue([])
    mockedApi.deleteRound.mockResolvedValue()
    renderPanel('CAMPAIGN')

    await screen.findByRole('article', { name: 'Round 2' })
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Publish paused')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete round' }))

    expect(mockedApi.deleteRound).toHaveBeenCalledWith('biz-1', 'camp-1', 'round-2')
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
  })

  it('shows an error when the rounds cannot be loaded', async () => {
    mockedApi.listRounds.mockRejectedValue(new api.ApiError(500, 'Server down'))
    renderPanel('CAMPAIGN')
    expect(await screen.findByRole('alert')).toHaveTextContent('Server down')
  })

  it('uses a generic message for an unexpected failure', async () => {
    mockedApi.listRounds.mockRejectedValue('boom')
    renderPanel('CAMPAIGN')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the rounds')
  })
})

describe('CreativeRoundsPanel with ad-set budgets', () => {
  const overview = (overrides: Partial<api.RoundsOverview> = {}): api.RoundsOverview => ({
    maxRounds: 3,
    nextRoundProblem: null,
    rounds: [],
    ...overrides,
  })
  const runningRound: api.PublishedRound = {
    number: 1,
    startsAt: '2026-11-12T12:00:00Z',
    endsAt: '2099-11-22T12:00:00Z',
    adSets: [
      {
        id: 's1',
        name: 'Rings — Round 1',
        isWinners: false,
        dailyBudget: 100,
        startDate: '2026-11-12T12:00:00Z',
        endDate: '2099-11-22T12:00:00Z',
        spend: 0,
        ads: [],
      },
    ],
  }
  const launchSummary: api.RoundLaunchSummary = {
    restartsCampaign: false,
    newAdSet: { dailyBudget: 100, adCount: 1 },
    winnersAdSet: null,
    winnerCandidates: [],
    maxWinners: 4,
    needsChoice: false,
    dailyTotal: 100,
    plannedMax: 1000,
    durationDays: 10,
  }

  function renderAdSetPanel() {
    render(
      <CreativeRoundsPanel
        businessId="biz-1"
        campaignId="camp-1"
        roundsBudget="AD_SET"
        pollMs={1}
      />,
    )
  }

  beforeEach(() => {
    vi.resetAllMocks()
    mockedApi.listRounds.mockResolvedValue([])
    mockedApi.getRoundsOverview.mockResolvedValue(overview())
    mockedApi.getRoundLaunchSummary.mockResolvedValue(launchSummary)
  })

  it('takes new rounds, not the shared-budget message', async () => {
    renderAdSetPanel()

    const add = await screen.findByRole('button', { name: 'Add new round' })
    await waitFor(() => expect(add).toBeEnabled())
    expect(screen.queryByText(SHARED_BUDGET_MESSAGE)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'See which ads to pause' })).toBeInTheDocument()
  })

  it('locks the next round while the current one runs, and says why', async () => {
    mockedApi.getRoundsOverview.mockResolvedValue(
      overview({
        nextRoundProblem: 'Round 1 is still running until Nov 22. You can add round 2 then.',
        rounds: [runningRound],
      }),
    )

    renderAdSetPanel()

    expect(await screen.findByText(/Round 1 is still running until Nov 22/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add new round' })).toBeDisabled()
    expect(screen.getByRole('article', { name: 'Published round 1' })).toBeInTheDocument()
  })

  it('ends the running round early, after a confirmation, and refreshes', async () => {
    mockedApi.getRoundsOverview.mockResolvedValue(overview({ rounds: [runningRound] }))
    mockedApi.endRoundEarly.mockResolvedValue({
      roundNumber: 1,
      endedAt: '2026-11-14T00:00:00Z',
    })
    renderAdSetPanel()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'End round early' }))
    await user.click(screen.getByRole('button', { name: 'End round 1 now' }))

    await waitFor(() => expect(mockedApi.endRoundEarly).toHaveBeenCalledWith('biz-1', 'camp-1'))
    await waitFor(() => expect(mockedApi.getRoundsOverview).toHaveBeenCalledTimes(2))
  })

  it('publishes an open round from its launch summary, with no paused option', async () => {
    mockedApi.listRounds.mockResolvedValue([
      makeRound({
        selectedCount: 1,
        creatives: [makeCreative('a', { status: 'SELECTED' }), makeCreative('b')],
      }),
    ])
    mockedApi.publishRound.mockResolvedValue(makeRound({ status: 'CLOSED' }))
    mockedApi.getPublishStatus.mockResolvedValue({ state: 'IDLE' } as api.PublishStatus)
    renderAdSetPanel()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Publish round 2' }))

    await waitFor(() =>
      expect(mockedApi.publishRound).toHaveBeenCalledWith('biz-1', 'camp-1', 'round-2', {
        confirmRestart: false,
      }),
    )
    expect(screen.queryByLabelText('Publish paused')).not.toBeInTheDocument()
    await waitFor(() => expect(mockedApi.getRoundsOverview).toHaveBeenCalledTimes(2))
  })

  it('shows a published round without calling it a pack', async () => {
    mockedApi.listRounds.mockResolvedValue([makeRound({ status: 'CLOSED' })])

    renderAdSetPanel()

    expect(await screen.findByText('Published')).toBeInTheDocument()
    expect(screen.queryByText(/Pack 2/)).not.toBeInTheDocument()
  })

  it('shows the error when ending the round fails', async () => {
    mockedApi.getRoundsOverview.mockResolvedValue(overview({ rounds: [runningRound] }))
    mockedApi.endRoundEarly.mockRejectedValue(new api.ApiError(500, 'Meta refused'))
    renderAdSetPanel()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'End round early' }))
    await user.click(screen.getByRole('button', { name: 'End round 1 now' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta refused')
  })

  it('generates a round and shows it', async () => {
    mockedApi.createRound.mockResolvedValue(makeRound())
    mockedApi.listRounds.mockResolvedValueOnce([]).mockResolvedValue([makeRound()])
    renderAdSetPanel()
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
    renderAdSetPanel()
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
    renderAdSetPanel()
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

  it('marks a round angle that reused a saved concept with "From your avatar"', async () => {
    const open = makeRound({
      angles: [
        {
          avatar: 'self_purchaser',
          concept: 'nobody-chose-this-for',
          pillar: 'emotion',
          description: 'Saved.',
          fromSavedConcept: true,
        },
        {
          avatar: 'gift_buyer',
          concept: 'easy-returns',
          pillar: 'offer',
          description: 'Invented.',
          fromSavedConcept: false,
        },
        {
          avatar: 'gift_buyer',
          concept: 'daily-ritual',
          pillar: 'emotion',
          description: 'Older plan.',
        },
      ],
    })
    mockedApi.listRounds.mockResolvedValue([open])
    renderAdSetPanel()

    const saved = (await screen.findByText(/Nobody chose this for/)).closest('li') as HTMLElement
    expect(within(saved).getByText('From your avatar')).toBeInTheDocument()
    expect(screen.getAllByText('From your avatar')).toHaveLength(1)
  })

  describe('publishing in the background', () => {
    const openRound = () =>
      makeRound({ creatives: [makeCreative('a', { status: 'SELECTED' })], selectedCount: 1 })

    it('shows the progress of a video round and refreshes when it is done', async () => {
      const closed = makeRound({ ...openRound(), status: 'CLOSED' })
      mockedApi.listRounds.mockResolvedValueOnce([openRound()]).mockResolvedValue([closed])
      mockedApi.publishRound.mockResolvedValue(closed)
      // The second status check waits on a gate the test opens, so the first step stays on
      // screen for as long as the assertions need instead of racing the poller (1 ms here).
      let openGate: () => void = () => undefined
      const gate = new Promise<void>((resolve) => (openGate = resolve))
      mockedApi.getPublishStatus
        .mockResolvedValueOnce({ state: 'PROCESSING', step: 'Processing video', progress: 40 })
        .mockImplementationOnce(async () => {
          await gate
          return { state: 'PROCESSING', step: 'Uploading video' }
        })
        .mockResolvedValue({ state: 'DONE' })
      renderAdSetPanel()

      await userEvent.click(await screen.findByRole('button', { name: 'Publish round 2' }))

      expect(await screen.findByRole('button', { name: 'Processing video 40%' })).toBeDisabled()
      openGate()
      expect(await screen.findByText('Published')).toBeVisible()
      expect(mockedApi.getPublishStatus).toHaveBeenCalledTimes(3)
    })

    it('reports a background publish that failed and keeps the round open', async () => {
      mockedApi.listRounds.mockResolvedValue([openRound()])
      mockedApi.publishRound.mockResolvedValue(openRound())
      mockedApi.getPublishStatus.mockResolvedValue({ state: 'FAILED', error: 'Video rejected' })
      renderAdSetPanel()

      await userEvent.click(await screen.findByRole('button', { name: 'Publish round 2' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Video rejected')
      expect(screen.getByRole('button', { name: 'Publish round 2' })).toBeEnabled()
    })

    it('falls back to a generic message when a failed publish gives no reason', async () => {
      mockedApi.listRounds.mockResolvedValue([openRound()])
      mockedApi.publishRound.mockResolvedValue(openRound())
      mockedApi.getPublishStatus.mockResolvedValue({ state: 'FAILED' })
      renderAdSetPanel()

      await userEvent.click(await screen.findByRole('button', { name: 'Publish round 2' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('could not be published')
    })

    it('shows the error when publishing is refused', async () => {
      mockedApi.listRounds.mockResolvedValue([openRound()])
      mockedApi.publishRound.mockRejectedValue(new api.ApiError(400, 'Add a Pixel first'))
      renderAdSetPanel()

      await userEvent.click(await screen.findByRole('button', { name: 'Publish round 2' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Add a Pixel first')
    })
  })

  it('deletes an open round', async () => {
    mockedApi.listRounds.mockResolvedValueOnce([makeRound()]).mockResolvedValue([])
    mockedApi.deleteRound.mockResolvedValue()
    renderAdSetPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete round' }))

    expect(mockedApi.deleteRound).toHaveBeenCalledWith('biz-1', 'camp-1', 'round-2')
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
  })

  it('shows an error when generating a round fails', async () => {
    mockedApi.createRound.mockRejectedValue(new api.ApiError(409, 'A round is already open'))
    renderAdSetPanel()
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
    renderAdSetPanel()
    expect(await screen.findByText('Craftsmanship')).toBeVisible()
  })
})
