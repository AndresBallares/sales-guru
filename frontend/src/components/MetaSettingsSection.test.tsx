import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { MetaSettingsSection } from './MetaSettingsSection'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, getMetaConnection: vi.fn<typeof actual.getMetaConnection>() }
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
})
