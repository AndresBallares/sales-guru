import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { usePixelHealth } from '../lib/usePixelHealth'
import { PixelPublishConfirm } from './PixelPublishConfirm'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, getPixelHealth: vi.fn<typeof actual.getPixelHealth>() }
})
const mockedApi = vi.mocked(api)

function health(status: api.PixelHealthStatus): api.PixelHealth {
  return {
    status,
    pixelId: 'p1',
    pixelName: 'venzi jewelry',
    lastFiredAt: null,
    checkedAt: '2026-11-08T02:10:00Z',
    warning: status === 'ok' ? null : 'This Pixel (venzi jewelry) received no website events.',
    otherPixels: [],
    windowDays: 30,
  }
}

// A stand-in publish button, gated the way the real ones are.
function Screen() {
  const pixel = usePixelHealth('b1')
  return (
    <>
      <PixelPublishConfirm pixel={pixel} />
      <button type="button" disabled={pixel.blocked}>
        Approve & Publish
      </button>
    </>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('publishing with a Pixel that is not receiving events', () => {
  it('holds the publish button until the owner confirms', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(health('no_events'))
    render(<Screen />)

    const confirm = await screen.findByRole('checkbox', { name: /Publish anyway/ })
    expect(screen.getByRole('alert')).toHaveTextContent('received no website events')
    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeDisabled()

    await userEvent.click(confirm)

    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeEnabled()
  })

  it('holds it for a Pixel Meta marks unavailable too', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(health('unavailable'))
    render(<Screen />)

    await screen.findByRole('checkbox', { name: /Publish anyway/ })
    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeDisabled()
  })

  it('does not hold it for a healthy Pixel, and asks for no confirmation', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(health('ok'))
    render(<Screen />)

    await waitFor(() => expect(mockedApi.getPixelHealth).toHaveBeenCalled())
    expect(screen.queryByRole('checkbox', { name: /Publish anyway/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeEnabled()
  })

  it('does not hold it for a purchase warning or when the check could not be made', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(health('no_purchase'))
    const { unmount } = render(<Screen />)
    await waitFor(() => expect(mockedApi.getPixelHealth).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeEnabled()
    unmount()

    mockedApi.getPixelHealth.mockResolvedValue(health('unreadable'))
    render(<Screen />)
    await waitFor(() => expect(mockedApi.getPixelHealth).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeEnabled()
  })

  it('never blocks while it is still looking, or if the check fails', async () => {
    mockedApi.getPixelHealth.mockReturnValue(new Promise(() => undefined))
    const { unmount } = render(<Screen />)
    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeEnabled()
    unmount()

    mockedApi.getPixelHealth.mockRejectedValue(new Error('boom'))
    render(<Screen />)
    await waitFor(() => expect(mockedApi.getPixelHealth).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeEnabled()
  })

  it('asks again for confirmation if a new check finds a different problem', async () => {
    mockedApi.getPixelHealth.mockResolvedValueOnce(health('no_events'))
    render(<Screen />)
    await userEvent.click(await screen.findByRole('checkbox', { name: /Publish anyway/ }))
    expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeEnabled()

    mockedApi.getPixelHealth.mockResolvedValueOnce(health('unavailable'))
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeDisabled(),
    )
  })
})
