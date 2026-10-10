import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { InstagramNote, NO_INSTAGRAM_NOTE } from './InstagramNote'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getMetaConnection: vi.fn<typeof actual.getMetaConnection>(),
    refreshMetaInstagram: vi.fn<typeof actual.refreshMetaInstagram>(),
    setMetaInstagramAccount: vi.fn<typeof actual.setMetaInstagramAccount>(),
  }
})

const mockedApi = vi.mocked(api)

function connection(overrides: Partial<api.MetaConnection> = {}): api.MetaConnection {
  return {
    id: 'conn-1',
    businessId: 'biz-1',
    metaUserId: 'meta-user-1',
    adAccountId: 'act_1',
    pageId: 'page_1',
    instagramUserId: null,
    instagramUserIdDiscovered: null,
    instagramUserIdManual: null,
    pixelId: 'pixel_1',
    pixelSkipped: false,
    tokenExpiresAt: '2030-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('InstagramNote', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('says nothing when an Instagram account is linked', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(connection({ instagramUserId: 'ig_1' }))
    render(<InstagramNote businessId="biz-1" />)

    await waitFor(() => expect(mockedApi.getMetaConnection).toHaveBeenCalled())
    expect(screen.queryByText(NO_INSTAGRAM_NOTE)).not.toBeInTheDocument()
  })

  it('shows the note when no Instagram account is linked', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(connection())
    render(<InstagramNote businessId="biz-1" />)

    expect(await screen.findByText(NO_INSTAGRAM_NOTE)).toBeInTheDocument()
  })

  it('says nothing when there is no connection or the lookup fails', async () => {
    mockedApi.getMetaConnection.mockRejectedValue(new api.ApiError(404, 'Meta connection not found'))
    render(<InstagramNote businessId="biz-1" />)

    await waitFor(() => expect(mockedApi.getMetaConnection).toHaveBeenCalled())
    expect(screen.queryByText(NO_INSTAGRAM_NOTE)).not.toBeInTheDocument()
  })

  it('says nothing before a Page has been chosen', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(connection({ pageId: null }))
    render(<InstagramNote businessId="biz-1" />)

    await waitFor(() => expect(mockedApi.getMetaConnection).toHaveBeenCalled())
    expect(screen.queryByText(NO_INSTAGRAM_NOTE)).not.toBeInTheDocument()
  })

  it('Check again re-reads Instagram and hides the note once one is linked', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(connection())
    mockedApi.refreshMetaInstagram.mockResolvedValue(connection({ instagramUserId: 'ig_1' }))
    render(<InstagramNote businessId="biz-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }))

    await waitFor(() => expect(screen.queryByText(NO_INSTAGRAM_NOTE)).not.toBeInTheDocument())
    expect(mockedApi.refreshMetaInstagram).toHaveBeenCalledWith('biz-1')
  })

  it('Check again keeps the note when still none is linked', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(connection())
    mockedApi.refreshMetaInstagram.mockResolvedValue(connection())
    render(<InstagramNote businessId="biz-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }))

    await waitFor(() => expect(mockedApi.refreshMetaInstagram).toHaveBeenCalled())
    expect(screen.getByText(NO_INSTAGRAM_NOTE)).toBeInTheDocument()
  })

  it('shows the error when Check again fails', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(connection())
    mockedApi.refreshMetaInstagram.mockRejectedValue(new api.ApiError(500, 'Meta is down'))
    render(<InstagramNote businessId="biz-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta is down')
    expect(screen.getByText(NO_INSTAGRAM_NOTE)).toBeInTheDocument()
  })
})

describe('InstagramNote manual entry', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('lets the user enter the account ID, and the note goes away once Meta accepts it', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(connection())
    mockedApi.setMetaInstagramAccount.mockResolvedValue(
      connection({ instagramUserId: '17841400000000001', instagramUserIdManual: '17841400000000001' }),
    )
    render(<InstagramNote businessId="biz-1" />)

    await userEvent.click(await screen.findByText('Enter the Instagram account ID yourself'))
    await userEvent.type(screen.getByLabelText('Instagram account ID'), '17841400000000001')
    await userEvent.click(screen.getByRole('button', { name: 'Save account ID' }))

    await waitFor(() => expect(screen.queryByText(NO_INSTAGRAM_NOTE)).not.toBeInTheDocument())
    expect(mockedApi.setMetaInstagramAccount).toHaveBeenCalledWith('biz-1', '17841400000000001')
  })

  it('stays quiet when a hand-entered account is already in use', async () => {
    mockedApi.getMetaConnection.mockResolvedValue(
      connection({ instagramUserId: '222222', instagramUserIdManual: '222222' }),
    )
    render(<InstagramNote businessId="biz-1" />)

    await waitFor(() => expect(mockedApi.getMetaConnection).toHaveBeenCalled())
    expect(screen.queryByText(NO_INSTAGRAM_NOTE)).not.toBeInTheDocument()
  })
})
