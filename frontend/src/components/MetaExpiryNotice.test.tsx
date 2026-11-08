import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MetaConnection } from '../lib/api'
import { formatDay } from '../lib/dashboardFormat'
import { MetaExpiryNotice } from './MetaExpiryNotice'

vi.mock('./ReconnectMetaButton', () => ({
  ReconnectMetaButton: ({ businessId }: { businessId: string }) => (
    <button type="button">Reconnect Meta ({businessId})</button>
  ),
}))

function connection(overrides: Partial<MetaConnection>): MetaConnection {
  return {
    id: 'c1',
    businessId: 'biz-1',
    metaUserId: 'u',
    adAccountId: 'act_1',
    pageId: 'p1',
    instagramUserId: null,
    instagramUserIdDiscovered: null,
    instagramUserIdManual: null,
    pixelId: 'px',
    pixelSkipped: false,
    tokenExpiresAt: '2026-12-10T03:31:37Z',
    expiryStatus: 'ok',
    daysUntilExpiry: 33,
    createdAt: '2026-09-04T02:15:16Z',
    ...overrides,
  }
}

describe('MetaExpiryNotice', () => {
  it('shows nothing while the connection is good', () => {
    const { container } = render(
      <MetaExpiryNotice businessId="biz-1" connection={connection({})} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('warns with the number of days left and offers to reconnect', () => {
    render(
      <MetaExpiryNotice
        businessId="biz-1"
        connection={connection({ expiryStatus: 'expiring_soon', daysUntilExpiry: 9 })}
      />,
    )

    const notice = screen.getByRole('alert')
    expect(notice).toHaveTextContent('Your Meta connection expires in 9 days')
    expect(notice).toHaveTextContent(formatDay('2026-12-10T03:31:37Z'))
    expect(screen.getByRole('button', { name: /Reconnect Meta/ })).toBeInTheDocument()
  })

  it('says one day, and less than a day, in words', () => {
    const { rerender } = render(
      <MetaExpiryNotice
        businessId="biz-1"
        connection={connection({ expiryStatus: 'expiring_soon', daysUntilExpiry: 1 })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('expires in 1 day')
    expect(screen.getByRole('alert')).not.toHaveTextContent('1 days')

    rerender(
      <MetaExpiryNotice
        businessId="biz-1"
        connection={connection({ expiryStatus: 'expiring_soon', daysUntilExpiry: 0 })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('expires in less than a day')
  })

  it('says the connection has expired and that results cannot update', () => {
    render(
      <MetaExpiryNotice
        businessId="biz-1"
        connection={connection({
          expiryStatus: 'expired',
          daysUntilExpiry: null,
          tokenExpiresAt: '2026-11-07T14:30:39Z',
        })}
      />,
    )

    const notice = screen.getByRole('alert')
    expect(notice).toHaveTextContent(
      `Your Meta connection expired on ${formatDay('2026-11-07T14:30:39Z')}`,
    )
    expect(notice).toHaveTextContent('Results can’t update until you reconnect')
    expect(screen.getByRole('button', { name: /Reconnect Meta/ })).toBeInTheDocument()
  })

  it('passes the business to the reconnect button', () => {
    render(
      <MetaExpiryNotice
        businessId="biz-7"
        connection={connection({ expiryStatus: 'expired', daysUntilExpiry: null })}
      />,
    )

    expect(screen.getByRole('button', { name: 'Reconnect Meta (biz-7)' })).toBeInTheDocument()
  })
})
