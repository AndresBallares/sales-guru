import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CampaignCard, type CampaignCardProps } from './CampaignCard'

function renderCard(overrides: Partial<CampaignCardProps> = {}) {
  const props: CampaignCardProps = {
    title: 'Spring Sale',
    subtitle: 'Sales',
    thumbnailUrl: 'https://img.example/ring.jpg',
    thumbnailAlt: 'Emerald ring',
    status: 'LIVE',
    badge: { label: 'Active', tone: 'success' },
    creativeText: '4 creatives',
    eventText: null,
    message: null,
    progress: null,
    primary: { label: 'View campaign', onClick: vi.fn<() => void>() },
    menuItems: [],
    ...overrides,
  }
  render(
    <ul>
      <CampaignCard {...props} />
    </ul>,
  )
  return props
}

describe('CampaignCard', () => {
  it('shows the campaign name as a heading, its objective and its creative count', () => {
    renderCard()

    expect(screen.getByRole('heading', { level: 3, name: 'Spring Sale' })).toBeInTheDocument()
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('4 creatives')).toBeInTheDocument()
  })

  it('shows the event line only for an event campaign', () => {
    renderCard({ eventText: 'Event: JCK Las Vegas (2026-06-01 – 2026-06-04)' })
    expect(screen.getByText(/Event: JCK Las Vegas/)).toBeInTheDocument()
  })

  it('shows the product photo with its alt text', () => {
    renderCard()

    const image = screen.getByRole('img', { name: 'Emerald ring' })
    expect(image).toHaveAttribute('src', 'https://img.example/ring.jpg')
  })

  it('shows a neutral placeholder instead of an image when there is no product photo', () => {
    renderCard({ thumbnailUrl: null })

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('.campaign-tile-placeholder')).toBeInTheDocument()
  })

  it('shows the status as text, not just colour, and exposes its tone', () => {
    renderCard({ badge: { label: 'Needs your review', tone: 'attention' }, status: 'ADS_GENERATED' })

    const badge = screen.getByText('Needs your review')
    expect(badge.closest('[data-tone]')).toHaveAttribute('data-tone', 'attention')
  })

  it('shows the one-line message only when there is one', () => {
    renderCard({ message: 'Next: generate your ads.' })
    expect(screen.getByText('Next: generate your ads.')).toBeInTheDocument()
  })

  it('shows an accessible progress bar only when given real progress', () => {
    renderCard({ progress: { value: 2, max: 3, label: '2 of 3 setup steps done' } })

    const bar = screen.getByRole('progressbar', { name: '2 of 3 setup steps done' })
    expect(bar).toHaveAttribute('value', '2')
    expect(bar).toHaveAttribute('max', '3')
    expect(screen.getByText('2 of 3 setup steps done')).toBeInTheDocument()
  })

  it('has no progress bar when there is no progress', () => {
    renderCard({ progress: null })

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('runs the primary action when it is clicked', async () => {
    const props = renderCard({ primary: { label: 'Continue setup', onClick: vi.fn<() => void>() } })

    await userEvent.click(screen.getByRole('button', { name: 'Continue setup' }))

    expect(props.primary.onClick).toHaveBeenCalledTimes(1)
  })

  it('can disable the primary action while it works', () => {
    renderCard({
      primary: { label: 'Resuming…', onClick: vi.fn<() => void>(), disabled: true },
    })

    expect(screen.getByRole('button', { name: 'Resuming…' })).toBeDisabled()
  })

  it('renders anything passed as children, such as a confirmation or an error', () => {
    renderCard({ children: <p role="alert">Could not activate campaign.</p> })

    expect(screen.getByRole('alert')).toHaveTextContent('Could not activate campaign.')
  })

  describe('the more-actions menu', () => {
    const items = () => [
      { key: 'details', label: 'View details', onClick: vi.fn<() => void>() },
      { key: 'delete', label: 'Delete', danger: true, onClick: vi.fn<() => void>() },
    ]

    it('has no menu button when there are no secondary actions', () => {
      renderCard({ menuItems: [] })

      expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument()
    })

    it('has a named menu button that starts closed', () => {
      renderCard({ menuItems: items() })

      const trigger = screen.getByRole('button', { name: 'More actions for Spring Sale' })
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('opens a menu of its actions and closes after one is chosen', async () => {
      const menuItems = items()
      renderCard({ menuItems })

      await userEvent.click(screen.getByRole('button', { name: 'More actions for Spring Sale' }))
      const menu = screen.getByRole('menu', { name: 'Actions for Spring Sale' })
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'View details',
        'Delete',
      ])

      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }))

      expect(menuItems[1].onClick).toHaveBeenCalledTimes(1)
      expect(menuItems[0].onClick).not.toHaveBeenCalled()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('moves focus into the menu, and Escape closes it and returns focus to the button', async () => {
      renderCard({ menuItems: items() })
      const trigger = screen.getByRole('button', { name: 'More actions for Spring Sale' })

      await userEvent.click(trigger)
      expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus()

      await userEvent.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
    })

    it('moves between actions with the arrow keys', async () => {
      renderCard({ menuItems: items() })
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Spring Sale' }))

      await userEvent.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()

      await userEvent.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus()
    })

    it('jumps to the first and last action with Home and End', async () => {
      renderCard({ menuItems: items() })
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Spring Sale' }))

      await userEvent.keyboard('{End}')
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()

      await userEvent.keyboard('{Home}')
      expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus()
    })

    it('closes when focus tabs out of the menu', async () => {
      renderCard({ menuItems: items() })
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Spring Sale' }))

      await userEvent.keyboard('{Tab}')

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('cannot choose an action that is disabled', async () => {
      const menuItems = [
        { key: 'a', label: 'Archive', disabled: true, onClick: vi.fn<() => void>() },
        { key: 'b', label: 'View details', onClick: vi.fn<() => void>() },
      ]
      renderCard({ menuItems })
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Spring Sale' }))

      expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeDisabled()
      expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus()
    })

    it('closes when the user clicks elsewhere', async () => {
      renderCard({ menuItems: items() })
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Spring Sale' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await userEvent.click(document.body)

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('marks a destructive action so it can be styled as one', async () => {
      renderCard({ menuItems: items() })
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Spring Sale' }))

      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('photo-menu-danger')
    })
  })
})
