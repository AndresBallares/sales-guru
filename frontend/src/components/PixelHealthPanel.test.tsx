import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { formatAsOf } from '../lib/dashboardFormat'
import { PixelHealthPanel } from './PixelHealthPanel'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, getPixelHealth: vi.fn<typeof actual.getPixelHealth>() }
})
const mockedApi = vi.mocked(api)

function health(overrides: Partial<api.PixelHealth> = {}): api.PixelHealth {
  return {
    status: 'ok',
    pixelId: '2024258651467538',
    pixelName: 'venzi jewelry',
    lastFiredAt: '2026-11-07T20:32:49Z',
    checkedAt: '2026-11-08T02:10:00Z',
    warning: null,
    otherPixels: [],
    windowDays: 30,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('PixelHealthPanel', () => {
  it('says the Pixel is receiving events, when it last did, and when it was checked', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(health())
    render(<PixelHealthPanel businessId="b1" />)

    const panel = await screen.findByLabelText('Pixel health')
    expect(panel).toHaveTextContent('venzi jewelry')
    expect(panel).toHaveTextContent('receiving events')
    expect(panel).toHaveTextContent(`Last event ${formatAsOf('2026-11-07T20:32:49Z')}`)
    expect(panel).toHaveTextContent(`Checked ${formatAsOf('2026-11-08T02:10:00Z')}`)
    expect(mockedApi.getPixelHealth).toHaveBeenCalledWith('b1', false)
  })

  it('warns when the Pixel received no events, naming the dataset that did', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(
      health({
        status: 'no_events',
        lastFiredAt: null,
        warning:
          'This Pixel (Sales Guru) received no website events in the last 30 days. Events from your store may be going to a different dataset. Other datasets on this ad account did receive events: venzi jewelry (last event Nov 7).',
        otherPixels: [
          { id: '2024258651467538', name: 'venzi jewelry', lastFiredAt: '2026-11-07T20:32:49Z' },
        ],
      }),
    )
    render(<PixelHealthPanel businessId="b1" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Check your Pixel')
    expect(alert).toHaveTextContent('received no website events in the last 30 days')
    expect(alert).toHaveTextContent('venzi jewelry')
    expect(alert).toHaveTextContent(`Checked ${formatAsOf('2026-11-08T02:10:00Z')}`)
  })

  it('keeps the existing purchase warning for a Pixel with checkouts but no purchase', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(
      health({ status: 'no_purchase', warning: 'Purchase event may not be firing: 0 Purchase events.' }),
    )
    render(<PixelHealthPanel businessId="b1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Purchase event may not be firing')
  })

  it('flags a Pixel Meta marks unavailable', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(
      health({ status: 'unavailable', warning: 'Meta marks the Pixel “x” as unavailable.' }),
    )
    render(<PixelHealthPanel businessId="b1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
  })

  it('says it could not check, without shouting, and still shows when it tried', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(
      health({
        status: 'unreadable',
        pixelName: null,
        lastFiredAt: null,
        warning: 'Sales Guru couldn’t check the Pixel just now. It will try again shortly.',
      }),
    )
    render(<PixelHealthPanel businessId="b1" />)

    const panel = await screen.findByLabelText('Pixel health')
    expect(panel).toHaveTextContent('couldn’t check the Pixel')
    expect(panel).toHaveTextContent('Checked')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows nothing when no Pixel is selected', async () => {
    mockedApi.getPixelHealth.mockResolvedValue(health({ status: 'none_selected', pixelId: null }))
    const { container } = render(<PixelHealthPanel businessId="b1" />)

    await waitFor(() => expect(mockedApi.getPixelHealth).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing, and does not break the page, when the check itself fails', async () => {
    mockedApi.getPixelHealth.mockRejectedValue(new Error('boom'))
    const { container } = render(<PixelHealthPanel businessId="b1" />)

    await waitFor(() => expect(mockedApi.getPixelHealth).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('checks again on request and shows the new time', async () => {
    mockedApi.getPixelHealth.mockResolvedValueOnce(health()).mockResolvedValueOnce(
      health({ checkedAt: '2026-11-08T02:30:00Z' }),
    )
    render(<PixelHealthPanel businessId="b1" />)
    await screen.findByLabelText('Pixel health')

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Pixel health')).toHaveTextContent(
        `Checked ${formatAsOf('2026-11-08T02:30:00Z')}`,
      ),
    )
    expect(mockedApi.getPixelHealth).toHaveBeenLastCalledWith('b1', true)
  })

  it('disables Check again while it is looking', async () => {
    mockedApi.getPixelHealth
      .mockResolvedValueOnce(health())
      .mockReturnValueOnce(new Promise(() => undefined))
    render(<PixelHealthPanel businessId="b1" />)
    await screen.findByLabelText('Pixel health')

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))

    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
  })
})
