import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { InstagramAccountForm } from './InstagramAccountForm'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    setMetaInstagramAccount: vi.fn<typeof actual.setMetaInstagramAccount>(),
    refreshMetaInstagram: vi.fn<typeof actual.refreshMetaInstagram>(),
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

function renderForm(conn: api.MetaConnection, showCheckAgain = false) {
  const onUpdated = vi.fn<(updated: api.MetaConnection) => void>()
  render(
    <InstagramAccountForm
      businessId="biz-1"
      connection={conn}
      onUpdated={onUpdated}
      showCheckAgain={showCheckAgain}
    />,
  )
  return onUpdated
}

describe('InstagramAccountForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('says which account is in use and where it came from', () => {
    const { unmount } = render(
      <InstagramAccountForm
        businessId="biz-1"
        connection={connection({
          instagramUserId: '111111',
          instagramUserIdDiscovered: '111111',
        })}
        onUpdated={vi.fn()}
      />,
    )
    expect(screen.getByText(/111111 \(found on your Page\)/)).toBeInTheDocument()
    unmount()

    const second = render(
      <InstagramAccountForm
        businessId="biz-1"
        connection={connection({
          instagramUserId: '222222',
          instagramUserIdDiscovered: '111111',
          instagramUserIdManual: '222222',
        })}
        onUpdated={vi.fn()}
      />,
    )
    expect(screen.getByText(/222222 \(entered by you\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('Instagram account ID')).toHaveValue('222222')
    second.unmount()

    render(<InstagramAccountForm businessId="biz-1" connection={connection()} onUpdated={vi.fn()} />)
    expect(screen.getByText('No Instagram account in use.')).toBeInTheDocument()
  })

  it('saves the trimmed ID and reports the updated connection', async () => {
    const saved = connection({
      instagramUserId: '17841400000000001',
      instagramUserIdManual: '17841400000000001',
    })
    mockedApi.setMetaInstagramAccount.mockResolvedValue(saved)
    const onUpdated = renderForm(connection())

    expect(screen.getByRole('button', { name: 'Save account ID' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Instagram account ID'), '  17841400000000001 ')
    await userEvent.click(screen.getByRole('button', { name: 'Save account ID' }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(saved))
    expect(mockedApi.setMetaInstagramAccount).toHaveBeenCalledWith('biz-1', '17841400000000001')
  })

  it("shows Meta's rejection and keeps what was typed", async () => {
    mockedApi.setMetaInstagramAccount.mockRejectedValue(
      new api.ApiError(400, "Meta doesn't accept that Instagram account ID for this ad account and Page."),
    )
    const onUpdated = renderForm(connection())

    await userEvent.type(screen.getByLabelText('Instagram account ID'), '12345678')
    await userEvent.click(screen.getByRole('button', { name: 'Save account ID' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Meta doesn't accept that Instagram account ID")
    expect(screen.getByLabelText('Instagram account ID')).toHaveValue('12345678')
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('goes back to the account found on the Page', async () => {
    const cleared = connection({ instagramUserId: '111111', instagramUserIdDiscovered: '111111' })
    mockedApi.setMetaInstagramAccount.mockResolvedValue(cleared)
    const onUpdated = renderForm(
      connection({
        instagramUserId: '222222',
        instagramUserIdDiscovered: '111111',
        instagramUserIdManual: '222222',
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Use the one found on my Page' }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(cleared))
    expect(mockedApi.setMetaInstagramAccount).toHaveBeenCalledWith('biz-1', null)
  })

  it('offers no way back when nothing was entered by hand', () => {
    renderForm(connection())

    expect(screen.queryByRole('button', { name: 'Use the one found on my Page' })).not.toBeInTheDocument()
  })

  it('re-reads the Page when asked to check again', async () => {
    const found = connection({ instagramUserId: '111111', instagramUserIdDiscovered: '111111' })
    mockedApi.refreshMetaInstagram.mockResolvedValue(found)
    const onUpdated = renderForm(connection(), true)

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(found))
    expect(mockedApi.refreshMetaInstagram).toHaveBeenCalledWith('biz-1')
  })

  it('has no Check again button unless asked for one', () => {
    renderForm(connection())

    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
  })
})
