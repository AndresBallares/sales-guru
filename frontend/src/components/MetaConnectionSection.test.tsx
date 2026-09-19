import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MetaConnectionSection } from './MetaConnectionSection'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    connectMeta: vi.fn<typeof actual.connectMeta>(),
    getMetaConnection: vi.fn<typeof actual.getMetaConnection>(),
    listMetaAdAccounts: vi.fn<typeof actual.listMetaAdAccounts>(),
    listMetaPages: vi.fn<typeof actual.listMetaPages>(),
    listMetaPixels: vi.fn<typeof actual.listMetaPixels>(),
    finalizeMetaConnection: vi.fn<typeof actual.finalizeMetaConnection>(),
    setMetaPixel: vi.fn<typeof actual.setMetaPixel>(),
    skipMetaPixel: vi.fn<typeof actual.skipMetaPixel>(),
    disconnectMeta: vi.fn<typeof actual.disconnectMeta>(),
  }
})
const mockedApi = vi.mocked(api)

function renderSection(
  initialEntry = '/businesses/biz-1',
  onSetupComplete?: (complete: boolean) => void,
) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MetaConnectionSection businessId="biz-1" onSetupComplete={onSetupComplete} />
    </MemoryRouter>,
  )
}

const PENDING_CONNECTION: api.MetaConnection = {
  id: 'conn-1',
  businessId: 'biz-1',
  metaUserId: 'meta-user-1',
  adAccountId: null,
  pageId: null,
  pixelId: null,
  pixelSkipped: false,
  tokenExpiresAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-08-08T00:00:00Z',
}

const COMPLETE_CONNECTION: api.MetaConnection = {
  ...PENDING_CONNECTION,
  adAccountId: 'act_1',
  pageId: 'page_1',
}

beforeEach(() => {
  vi.resetAllMocks()
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { href: '' },
  })
  mockedApi.listMetaPixels.mockResolvedValue([])
})

describe('MetaConnectionSection', () => {
  it('shows a connect button when no connection exists yet', async () => {
    mockedApi.getMetaConnection.mockRejectedValue(
      new api.ApiError(404, 'Meta connection not found'),
    )

    renderSection()

    expect(await screen.findByText('Not connected yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect Meta Ads' })).toBeInTheDocument()
  })

  it('shows an error if the connection status fails to load for another reason', async () => {
    mockedApi.getMetaConnection.mockRejectedValue(new api.ApiError(500, 'Server error'))

    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('starts the OAuth flow and navigates the browser to the authorization URL', async () => {
    mockedApi.getMetaConnection.mockRejectedValue(
      new api.ApiError(404, 'Meta connection not found'),
    )
    mockedApi.connectMeta.mockResolvedValue({
      authorizationUrl: 'https://facebook.example/oauth/dialog',
    })
    const user = userEvent.setup()

    renderSection()
    await screen.findByRole('button', { name: 'Connect Meta Ads' })

    await user.click(screen.getByRole('button', { name: 'Connect Meta Ads' }))

    await waitFor(() => expect(mockedApi.connectMeta).toHaveBeenCalledWith('biz-1'))
    expect(window.location.href).toBe('https://facebook.example/oauth/dialog')
  })

  it('shows an error if starting the OAuth flow fails', async () => {
    mockedApi.getMetaConnection.mockRejectedValue(
      new api.ApiError(404, 'Meta connection not found'),
    )
    mockedApi.connectMeta.mockRejectedValue(
      new api.ApiError(500, 'META_APP_ID is not configured'),
    )
    const user = userEvent.setup()

    renderSection()
    await screen.findByRole('button', { name: 'Connect Meta Ads' })

    await user.click(screen.getByRole('button', { name: 'Connect Meta Ads' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'META_APP_ID is not configured',
    )
  })

  it('shows the ad account and Page picker for a pending connection', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(PENDING_CONNECTION)
    mockedApi.listMetaAdAccounts.mockResolvedValue([{ id: 'act_1', name: 'Acme Ads' }])
    mockedApi.listMetaPages.mockResolvedValue([{ id: 'page_1', name: 'Acme Jewelry' }])

    renderSection()

    expect(await screen.findByLabelText('Ad account')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Acme Ads' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Acme Jewelry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save connection' })).toBeDisabled()
  })

  it('finalizes the connection with the chosen ad account and Page', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(PENDING_CONNECTION)
    mockedApi.listMetaAdAccounts.mockResolvedValue([{ id: 'act_1', name: 'Acme Ads' }])
    mockedApi.listMetaPages.mockResolvedValue([{ id: 'page_1', name: 'Acme Jewelry' }])
    mockedApi.finalizeMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    const user = userEvent.setup()

    renderSection()
    await screen.findByRole('option', { name: 'Acme Ads' })
    await screen.findByRole('option', { name: 'Acme Jewelry' })

    await user.selectOptions(screen.getByLabelText('Ad account'), 'act_1')
    await user.selectOptions(screen.getByLabelText('Page'), 'page_1')
    await user.click(screen.getByRole('button', { name: 'Save connection' }))

    await waitFor(() =>
      expect(mockedApi.finalizeMetaConnection).toHaveBeenCalledWith('biz-1', {
        adAccountId: 'act_1',
        pageId: 'page_1',
      }),
    )
    expect(await screen.findByText(/Connected/)).toBeInTheDocument()
  })

  it('shows the connected state with a disconnect button once complete', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)

    renderSection()

    expect(await screen.findByText(/Connected/)).toBeInTheDocument()
    expect(screen.getByText('act_1')).toBeInTheDocument()
    expect(screen.getByText('page_1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('shows the Pixel picker once connected with no Pixel set yet', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.listMetaPixels.mockResolvedValue([{ id: 'pixel_1', name: 'Acme Pixel' }])

    renderSection()
    await screen.findByText(/Connected/)

    expect(await screen.findByLabelText('Meta Pixel')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Acme Pixel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Pixel' })).toBeDisabled()
    expect(screen.queryByText(/^Pixel:/)).not.toBeInTheDocument()
  })

  it('saves the chosen Pixel', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.listMetaPixels.mockResolvedValue([{ id: 'pixel_1', name: 'Acme Pixel' }])
    mockedApi.setMetaPixel.mockResolvedValue({ ...COMPLETE_CONNECTION, pixelId: 'pixel_1' })
    const user = userEvent.setup()

    renderSection()
    await screen.findByRole('option', { name: 'Acme Pixel' })

    await user.selectOptions(screen.getByLabelText('Meta Pixel'), 'pixel_1')
    await user.click(screen.getByRole('button', { name: 'Save Pixel' }))

    await waitFor(() =>
      expect(mockedApi.setMetaPixel).toHaveBeenCalledWith('biz-1', 'pixel_1'),
    )
    expect(await screen.findByText('Pixel:')).toBeInTheDocument()
    expect(screen.getByText('pixel_1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Meta Pixel')).not.toBeInTheDocument()
  })

  it('shows an error if saving the Pixel fails', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.listMetaPixels.mockResolvedValue([{ id: 'pixel_1', name: 'Acme Pixel' }])
    mockedApi.setMetaPixel.mockRejectedValue(new api.ApiError(500, 'Server error'))
    const user = userEvent.setup()

    renderSection()
    await screen.findByRole('option', { name: 'Acme Pixel' })

    await user.selectOptions(screen.getByLabelText('Meta Pixel'), 'pixel_1')
    await user.click(screen.getByRole('button', { name: 'Save Pixel' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('shows a friendly message and an accept-terms link when the ad account has not accepted the Business Tools Terms', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.listMetaPixels.mockRejectedValue(
      new api.ApiError(
        409,
        "Your Meta ad account hasn't accepted the Business Tools Terms yet. Accept them in Meta Business Settings, then retry.",
      ),
    )

    renderSection()
    await screen.findByText(/Connected/)

    expect(await screen.findByRole('alert')).toHaveTextContent('Business Tools Terms')
    const link = screen.getByRole('link', {
      name: 'Accept the Business Tools Terms in Meta Business Settings',
    })
    expect(link).toHaveAttribute(
      'href',
      'https://business.facebook.com/ads/manage/customaudiences/tos/?act=act_1',
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Meta Pixel')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Pixel' })).not.toBeInTheDocument()
    // Skip stays available — a Business Tools Terms failure shouldn't
    // block the whole Meta connection, only the optional Pixel step.
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
  })

  it('retries loading Pixels when Retry is clicked', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.listMetaPixels
      .mockRejectedValueOnce(new api.ApiError(409, 'Business Tools Terms not accepted'))
      .mockResolvedValueOnce([{ id: 'pixel_1', name: 'Acme Pixel' }])
    const user = userEvent.setup()

    renderSection()
    await screen.findByRole('button', { name: 'Retry' })

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByLabelText('Meta Pixel')).toBeInTheDocument()
    expect(mockedApi.listMetaPixels).toHaveBeenCalledTimes(2)
  })

  it('shows a generic message with no accept-terms link for any other Pixel-listing failure', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.listMetaPixels.mockRejectedValue(new api.ApiError(500, 'Server error'))

    renderSection()
    await screen.findByText(/Connected/)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
    expect(
      screen.queryByRole('link', { name: /Business Tools Terms/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows the current Pixel directly once one is already set, without a picker', async () => {
    mockedApi.getMetaConnection.mockResolvedValue({ ...COMPLETE_CONNECTION, pixelId: 'pixel_1' })

    renderSection()
    await screen.findByText(/Connected/)

    expect(screen.getByText('Pixel:')).toBeInTheDocument()
    expect(screen.getByText('pixel_1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Meta Pixel')).not.toBeInTheDocument()
  })

  it('disconnects and returns to the not-connected state', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.disconnectMeta.mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderSection()
    await screen.findByRole('button', { name: 'Disconnect' })

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(mockedApi.disconnectMeta).toHaveBeenCalledWith('biz-1'))
    expect(await screen.findByText('Not connected yet.')).toBeInTheDocument()
  })

  it('shows the API error message if disconnecting fails', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.disconnectMeta.mockRejectedValue(new api.ApiError(500, 'Server error'))
    const user = userEvent.setup()

    renderSection()
    await screen.findByRole('button', { name: 'Disconnect' })

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(await screen.findByText('Server error')).toBeInTheDocument()
  })

  it('shows a generic message if disconnecting fails for a non-API reason', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.disconnectMeta.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()

    renderSection()
    await screen.findByRole('button', { name: 'Disconnect' })

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(await screen.findByText('Could not disconnect Meta Ads.')).toBeInTheDocument()
  })

  it('shows a success banner when returning from a completed OAuth flow', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(PENDING_CONNECTION)
    mockedApi.listMetaAdAccounts.mockResolvedValue([])
    mockedApi.listMetaPages.mockResolvedValue([])

    renderSection('/businesses/biz-1?meta=connected')

    expect(
      await screen.findByText(/Meta account connected — choose an ad account/),
    ).toBeInTheDocument()
  })

  it('shows an error banner when returning from a failed OAuth flow', async () => {
    mockedApi.getMetaConnection.mockRejectedValue(
      new api.ApiError(404, 'Meta connection not found'),
    )

    renderSection('/businesses/biz-1?meta=error')

    expect(await screen.findByText('Could not connect to Meta. Please try again.')).toBeInTheDocument()
  })

  it('reports setup as incomplete while not connected, pending, or awaiting a Pixel decision', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    const onSetupComplete = vi.fn<(complete: boolean) => void>()

    renderSection('/businesses/biz-1', onSetupComplete)
    await screen.findByText(/Connected/)

    expect(onSetupComplete).toHaveBeenCalledWith(false)
    expect(onSetupComplete).not.toHaveBeenCalledWith(true)
  })

  it('reports setup as complete immediately when a Pixel is already saved', async () => {
    mockedApi.getMetaConnection.mockResolvedValue({ ...COMPLETE_CONNECTION, pixelId: 'pixel_1' })
    const onSetupComplete = vi.fn<(complete: boolean) => void>()

    renderSection('/businesses/biz-1', onSetupComplete)

    await waitFor(() => expect(onSetupComplete).toHaveBeenCalledWith(true))
  })

  it('reports setup as complete once the Pixel is saved', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.listMetaPixels.mockResolvedValue([{ id: 'pixel_1', name: 'Acme Pixel' }])
    mockedApi.setMetaPixel.mockResolvedValue({ ...COMPLETE_CONNECTION, pixelId: 'pixel_1' })
    const onSetupComplete = vi.fn<(complete: boolean) => void>()
    const user = userEvent.setup()

    renderSection('/businesses/biz-1', onSetupComplete)
    await screen.findByRole('option', { name: 'Acme Pixel' })
    expect(onSetupComplete).toHaveBeenCalledWith(false)

    await user.selectOptions(screen.getByLabelText('Meta Pixel'), 'pixel_1')
    await user.click(screen.getByRole('button', { name: 'Save Pixel' }))

    await waitFor(() => expect(onSetupComplete).toHaveBeenLastCalledWith(true))
  })

  it('reports setup as complete when the Pixel step is skipped', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.skipMetaPixel.mockResolvedValue({ ...COMPLETE_CONNECTION, pixelSkipped: true })
    const onSetupComplete = vi.fn<(complete: boolean) => void>()
    const user = userEvent.setup()

    renderSection('/businesses/biz-1', onSetupComplete)
    await screen.findByRole('button', { name: 'Skip for now' })
    expect(onSetupComplete).toHaveBeenCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    await waitFor(() => expect(onSetupComplete).toHaveBeenLastCalledWith(true))
    expect(mockedApi.skipMetaPixel).toHaveBeenCalledWith('biz-1')
  })

  it('shows an error if skipping the Pixel step fails', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.skipMetaPixel.mockRejectedValue(new api.ApiError(404, 'Meta connection not found'))
    const user = userEvent.setup()

    renderSection()
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta connection not found')
  })

  it('remembers a skipped Pixel across a remount, instead of asking again', async () => {
    // Regression test: skipping the Pixel step used to only set local
    // React state, forgotten on every remount (e.g. navigating to the ad
    // page and back) — bouncing the user straight back to this section
    // instead of the Campaigns view they were already past. Fixed by
    // persisting the choice on MetaConnection itself (confirmed 2026-09-09)
    // — simulated here by the second mount's getMetaConnection call
    // already returning pixelSkipped: true, as a real backend would.
    mockedApi.getMetaConnection
      .mockResolvedValueOnce(COMPLETE_CONNECTION)
      .mockResolvedValueOnce({ ...COMPLETE_CONNECTION, pixelSkipped: true })
    mockedApi.skipMetaPixel.mockResolvedValue({ ...COMPLETE_CONNECTION, pixelSkipped: true })
    const user = userEvent.setup()
    const firstMount = render(
      <MemoryRouter initialEntries={['/businesses/biz-1']}>
        <MetaConnectionSection businessId="biz-1" />
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }))
    firstMount.unmount()

    const onSetupComplete = vi.fn<(complete: boolean) => void>()
    renderSection('/businesses/biz-1', onSetupComplete)

    // Reported complete right away this time — no second click needed.
    await waitFor(() => expect(onSetupComplete).toHaveBeenCalledWith(true))
  })

  it('forgets a skipped Pixel once the connection is disconnected', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    mockedApi.skipMetaPixel.mockResolvedValue({ ...COMPLETE_CONNECTION, pixelSkipped: true })
    mockedApi.disconnectMeta.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const firstMount = render(
      <MemoryRouter initialEntries={['/businesses/biz-1']}>
        <MetaConnectionSection businessId="biz-1" />
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }))
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await screen.findByText('Not connected yet.')
    firstMount.unmount()

    // The disconnected MetaConnection row is gone server-side, so a fresh
    // connection comes back with pixelSkipped reset to its default.
    mockedApi.getMetaConnection.mockResolvedValue(COMPLETE_CONNECTION)
    const onSetupComplete = vi.fn<(complete: boolean) => void>()
    renderSection('/businesses/biz-1', onSetupComplete)

    await screen.findByRole('button', { name: 'Skip for now' })
    expect(onSetupComplete).not.toHaveBeenCalledWith(true)
  })
})
