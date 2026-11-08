import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { ReconnectMetaButton } from './ReconnectMetaButton'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, reconnectMeta: vi.fn<typeof actual.reconnectMeta>() }
})
const mockedApi = vi.mocked(api)

describe('ReconnectMetaButton', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    Object.defineProperty(window, 'location', { writable: true, value: { href: '' } })
  })

  it('starts the existing reconnect and sends the browser to Meta', async () => {
    mockedApi.reconnectMeta.mockResolvedValue({ authorizationUrl: 'https://meta.example/dialog' })
    render(<ReconnectMetaButton businessId="biz-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect Meta' }))

    await waitFor(() => expect(window.location.href).toBe('https://meta.example/dialog'))
    expect(mockedApi.reconnectMeta).toHaveBeenCalledWith('biz-1')
  })

  it('shows progress while it opens Meta', async () => {
    mockedApi.reconnectMeta.mockReturnValue(new Promise(() => undefined))
    render(<ReconnectMetaButton businessId="biz-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect Meta' }))

    expect(screen.getByRole('button', { name: 'Opening Meta…' })).toBeDisabled()
  })

  it('says so when it cannot start, and can be tried again', async () => {
    mockedApi.reconnectMeta.mockRejectedValue(new api.ApiError(500, 'Meta app not configured'))
    render(<ReconnectMetaButton businessId="biz-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect Meta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta app not configured')
    expect(screen.getByRole('button', { name: 'Reconnect Meta' })).toBeEnabled()
  })

  it('falls back to a generic message for an unexpected failure', async () => {
    mockedApi.reconnectMeta.mockRejectedValue(new Error('boom'))
    render(<ReconnectMetaButton businessId="biz-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect Meta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start reconnecting Meta.')
  })
})
