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
    finalizeMetaConnection: vi.fn<typeof actual.finalizeMetaConnection>(),
    disconnectMeta: vi.fn<typeof actual.disconnectMeta>(),
  }
})
const mockedApi = vi.mocked(api)

function renderSection(initialEntry = '/businesses/biz-1') {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MetaConnectionSection businessId="biz-1" />
    </MemoryRouter>,
  )
}

const PENDING_CONNECTION: api.MetaConnection = {
  id: 'conn-1',
  businessId: 'biz-1',
  metaUserId: 'meta-user-1',
  adAccountId: null,
  pageId: null,
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
})
