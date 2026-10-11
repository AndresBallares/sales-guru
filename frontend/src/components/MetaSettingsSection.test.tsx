import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { MetaSettingsSection } from './MetaSettingsSection'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getMetaConnection: vi.fn<typeof actual.getMetaConnection>(),
    reconnectMeta: vi.fn<typeof actual.reconnectMeta>(),
    listMetaPages: vi.fn<typeof actual.listMetaPages>(),
    finalizeMetaConnection: vi.fn<typeof actual.finalizeMetaConnection>(),
  }
})

const mockedApi = vi.mocked(api)

const CONNECTION: api.MetaConnection = {
  id: 'conn-1',
  businessId: 'biz-1',
  metaUserId: 'meta-user-1',
  adAccountId: 'act_1',
  pageId: 'page_1',
  instagramUserId: '111111',
  instagramUserIdDiscovered: '111111',
  instagramUserIdManual: null,
  pixelId: 'pixel_1',
  pixelSkipped: false,
  tokenExpiresAt: '2030-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
}

describe('MetaSettingsSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    Object.defineProperty(window, 'location', { writable: true, value: { href: '' } })
  })

  it('shows the Instagram account settings once a Page is connected', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(CONNECTION)
    render(<MetaSettingsSection businessId="biz-1" />)

    expect(await screen.findByText('Meta connection settings')).toBeInTheDocument()
    expect(screen.getByText(/111111 \(found on your Page\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
  })

  it('renders nothing without a connection or before a Page is chosen', async () => {
    mockedApi.getMetaConnection.mockRejectedValueOnce(new api.ApiError(404, 'not found'))
    const first = render(<MetaSettingsSection businessId="biz-1" />)
    await waitFor(() => expect(mockedApi.getMetaConnection).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Meta connection settings')).not.toBeInTheDocument()
    first.unmount()

    mockedApi.getMetaConnection.mockResolvedValueOnce({ ...CONNECTION, pageId: null })
    render(<MetaSettingsSection businessId="biz-1" />)
    await waitFor(() => expect(mockedApi.getMetaConnection).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Meta connection settings')).not.toBeInTheDocument()
  })

  it('Reconnect Meta starts the OAuth dialog for this business', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(CONNECTION)
    mockedApi.reconnectMeta.mockResolvedValue({ authorizationUrl: 'https://meta.example/dialog' })
    render(<MetaSettingsSection businessId="biz-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Reconnect Meta' }))

    await waitFor(() => expect(window.location.href).toBe('https://meta.example/dialog'))
    expect(mockedApi.reconnectMeta).toHaveBeenCalledWith('biz-1')
  })

  it('says what reconnecting does, and that the ad account and Page stay', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(CONNECTION)
    render(<MetaSettingsSection businessId="biz-1" />)

    expect(await screen.findByText(/Your\s+ad account, Page and Pixel stay as they are/)).toBeInTheDocument()
  })

  it('shows why reconnecting could not start', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(CONNECTION)
    mockedApi.reconnectMeta.mockRejectedValue(new api.ApiError(500, 'Meta app not configured'))
    render(<MetaSettingsSection businessId="biz-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Reconnect Meta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta app not configured')
    expect(screen.getByRole('button', { name: 'Reconnect Meta' })).toBeEnabled()
  })

  it('confirms a reconnect and opens the section when returning from Meta', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(CONNECTION)
    render(<MetaSettingsSection businessId="biz-1" outcome="reconnected" />)

    expect(await screen.findByText(/Meta reconnected — the connection now has the current permissions/)).toBeInTheDocument()
    expect(screen.getByText('Meta connection settings').closest('details')).toHaveAttribute('open')
  })

  it('stays collapsed and quiet without a reconnect outcome', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(CONNECTION)
    render(<MetaSettingsSection businessId="biz-1" />)

    await screen.findByText('Meta connection settings')
    expect(screen.queryByText(/Meta reconnected/)).not.toBeInTheDocument()
    expect(screen.getByText('Meta connection settings').closest('details')).not.toHaveAttribute('open')
  })

  it('switches to another Page, keeping the ad account', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(CONNECTION)
    mockedApi.listMetaPages.mockResolvedValue([
      { id: 'page_1', name: 'VENZI Jewelry' },
      { id: 'page_2', name: 'Other Page' },
    ])
    const switched = { ...CONNECTION, pageId: 'page_2', instagramUserId: null, instagramUserIdDiscovered: null }
    mockedApi.finalizeMetaConnection.mockResolvedValue(switched)
    render(<MetaSettingsSection businessId="biz-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Choose a different Page' }))
    expect(await screen.findByRole('option', { name: 'VENZI Jewelry (current)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use this Page' })).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Page'), 'page_2')
    await userEvent.click(screen.getByRole('button', { name: 'Use this Page' }))

    await waitFor(() =>
      expect(mockedApi.finalizeMetaConnection).toHaveBeenCalledWith('biz-1', {
        adAccountId: 'act_1',
        pageId: 'page_2',
      }),
    )
    await waitFor(() => expect(screen.queryByLabelText('Page')).not.toBeInTheDocument())
    expect(screen.getByText('page_2')).toBeInTheDocument()
  })

  it('does not offer to "switch" to the current Page', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(CONNECTION)
    mockedApi.listMetaPages.mockResolvedValue([{ id: 'page_1', name: 'VENZI Jewelry' }])
    render(<MetaSettingsSection businessId="biz-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Choose a different Page' }))
    await userEvent.selectOptions(await screen.findByLabelText('Page'), 'page_1')

    expect(screen.getByRole('button', { name: 'Use this Page' })).toBeDisabled()
  })

  it('shows the error when the Pages cannot be loaded or the switch fails', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(CONNECTION)
    mockedApi.listMetaPages.mockRejectedValueOnce(new api.ApiError(500, 'Meta is down'))
    render(<MetaSettingsSection businessId="biz-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Choose a different Page' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Meta is down')

    mockedApi.listMetaPages.mockResolvedValue([
      { id: 'page_1', name: 'VENZI Jewelry' },
      { id: 'page_2', name: 'Other Page' },
    ])
    mockedApi.finalizeMetaConnection.mockRejectedValue(new api.ApiError(500, 'Could not save'))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a different Page' }))
    await userEvent.selectOptions(await screen.findByLabelText('Page'), 'page_2')
    await userEvent.click(screen.getByRole('button', { name: 'Use this Page' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
  })
})
