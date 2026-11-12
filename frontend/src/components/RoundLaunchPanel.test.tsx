import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { RoundLaunchPanel } from './RoundLaunchPanel'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getRoundLaunchSummary: vi.fn<typeof actual.getRoundLaunchSummary>(),
    chooseRoundWinners: vi.fn<typeof actual.chooseRoundWinners>(),
  }
})
const mockedApi = vi.mocked(api)

function candidate(id: string, round: number, chosen = true): api.WinnerCandidate {
  return {
    creativeId: id,
    adName: `Ad ${id}`,
    headline: `Headline ${id}`,
    avatar: 'gift_buyer',
    concept: 'made-to-last',
    firstRound: round,
    chosen,
  }
}

function summary(overrides: Partial<api.RoundLaunchSummary> = {}): api.RoundLaunchSummary {
  return {
    restartsCampaign: false,
    newAdSet: { dailyBudget: 100, adCount: 4 },
    winnersAdSet: { dailyBudget: 50, adCount: 2 },
    winnerCandidates: [candidate('a', 1), candidate('b', 1)],
    maxWinners: 4,
    needsChoice: false,
    dailyTotal: 150,
    plannedMax: 1500,
    durationDays: 10,
    ...overrides,
  }
}

function renderPanel(onPublish = vi.fn<(confirmRestart: boolean) => void>()) {
  render(
    <RoundLaunchPanel
      businessId="biz-1"
      campaignId="camp-1"
      roundId="round-2"
      roundNumber={2}
      selectedCount={4}
      busy={false}
      publishLabel={null}
      onPublish={onPublish}
    />,
  )
  return onPublish
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('RoundLaunchPanel', () => {
  it('shows both budgets, the winners and the most the round can spend', async () => {
    mockedApi.getRoundLaunchSummary.mockResolvedValue(summary())

    renderPanel()

    expect(await screen.findByText(/4 new ads at \$100\/day/)).toBeInTheDocument()
    expect(screen.getByText(/2 winners from earlier rounds at \$50\/day/)).toBeInTheDocument()
    expect(screen.getByText(/\$150\/day/)).toBeInTheDocument()
    expect(screen.getByText(/up to \$1,500 over 10 days/)).toBeInTheDocument()
    expect(screen.getAllByText(/Carried from round 1/)).toHaveLength(2)
    expect(mockedApi.getRoundLaunchSummary).toHaveBeenCalledWith('biz-1', 'camp-1', 'round-2')
  })

  it('says there is no winners ad set when no earlier ad is active', async () => {
    mockedApi.getRoundLaunchSummary.mockResolvedValue(
      summary({
        winnersAdSet: null,
        winnerCandidates: [],
        dailyTotal: 100,
        plannedMax: 1000,
      }),
    )

    renderPanel()

    expect(await screen.findByText(/No earlier ads are active/)).toBeInTheDocument()
    expect(screen.getByText(/up to \$1,000 over 10 days/)).toBeInTheDocument()
  })

  it('publishes the round, with no paused option', async () => {
    mockedApi.getRoundLaunchSummary.mockResolvedValue(summary())
    const onPublish = renderPanel()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Publish round 2' }))

    expect(onPublish).toHaveBeenCalledWith(false)
    expect(screen.queryByLabelText(/Publish paused/i)).not.toBeInTheDocument()
  })

  it('needs the restart confirmed before it publishes into a paused campaign', async () => {
    mockedApi.getRoundLaunchSummary.mockResolvedValue(summary({ restartsCampaign: true }))
    const onPublish = renderPanel()
    const user = userEvent.setup()

    const button = await screen.findByRole('button', { name: 'Publish round 2' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/restarts the paused campaign/i)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /restart the campaign/i }))
    await user.click(button)

    expect(onPublish).toHaveBeenCalledWith(true)
  })

  it('asks the user to choose when more ads are active than a round can carry', async () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => candidate(id, id < 'd' ? 1 : 2, false))
    mockedApi.getRoundLaunchSummary.mockResolvedValue(
      summary({
        winnersAdSet: null,
        winnerCandidates: many,
        needsChoice: true,
        dailyTotal: 100,
        plannedMax: 1000,
      }),
    )
    const after = (ids: string[]) =>
      summary({
        winnerCandidates: many.map((c) => ({ ...c, chosen: ids.includes(c.creativeId) })),
      })
    mockedApi.chooseRoundWinners
      .mockResolvedValueOnce(after(['a']))
      .mockResolvedValueOnce(after(['a', 'b']))
    renderPanel()
    const user = userEvent.setup()

    expect(await screen.findByText(/Choose up to 4/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish round 2' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Headline a/ }))
    await waitFor(() =>
      expect(mockedApi.chooseRoundWinners).toHaveBeenLastCalledWith('biz-1', 'camp-1', 'round-2', [
        'a',
      ]),
    )
    await user.click(screen.getByRole('checkbox', { name: /Headline b/ }))
    await waitFor(() =>
      expect(mockedApi.chooseRoundWinners).toHaveBeenLastCalledWith('biz-1', 'camp-1', 'round-2', [
        'a',
        'b',
      ]),
    )
    expect(await screen.findByRole('button', { name: 'Publish round 2' })).toBeEnabled()
  })

  it('shows why a pick was refused', async () => {
    mockedApi.getRoundLaunchSummary.mockResolvedValue(summary())
    mockedApi.chooseRoundWinners.mockRejectedValue(
      new api.ApiError(400, 'A round can carry at most 4 winners.'),
    )
    renderPanel()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: /Headline a/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('at most 4 winners')
  })

  it('shows the busy label on the button while a publish runs', async () => {
    mockedApi.getRoundLaunchSummary.mockResolvedValue(summary())
    render(
      <RoundLaunchPanel
        businessId="biz-1"
        campaignId="camp-1"
        roundId="round-2"
        roundNumber={2}
        selectedCount={4}
        busy
        publishLabel="Uploading 40%"
        onPublish={vi.fn<(confirmRestart: boolean) => void>()}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Uploading 40%' })).toBeDisabled()
  })

  it('says so when the summary cannot be loaded', async () => {
    mockedApi.getRoundLaunchSummary.mockRejectedValue(new api.ApiError(500, 'Meta is down'))

    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta is down')
  })
})
