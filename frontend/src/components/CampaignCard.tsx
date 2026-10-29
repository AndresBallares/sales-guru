import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { BadgeTone, CardProgress } from '../lib/campaignCard'
import { MoreIcon, PackageIcon } from './icons'

export interface CardMenuItem {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

export interface CampaignCardProps {
  title: string
  // The objective, shown under the name.
  subtitle: string | null
  thumbnailUrl: string | null
  thumbnailAlt: string
  // The campaign's stored status, kept on the element for tests and styling hooks.
  status: string
  badge: { label: string; tone: BadgeTone }
  creativeText: string
  // An event campaign's venue and dates; null for any other campaign.
  eventText: string | null
  message: string | null
  progress: CardProgress | null
  primary: { label: string; onClick: () => void; disabled?: boolean }
  menuItems: CardMenuItem[]
  // A confirmation or an error that belongs to this card.
  children?: ReactNode
}

// One campaign on the overview: enough to recognise it and know what to do next. The
// detailed editing stays in the campaign's own view, which the primary action opens.
export function CampaignCard({
  title,
  subtitle,
  thumbnailUrl,
  thumbnailAlt,
  status,
  badge,
  creativeText,
  eventText,
  message,
  progress,
  primary,
  menuItems,
  children,
}: CampaignCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  // Close when the user clicks or taps anywhere outside the menu.
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [menuOpen])

  // Put focus on the first action once the menu has rendered.
  useEffect(() => {
    if (menuOpen) {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    }
  }, [menuOpen])

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    )
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      setMenuOpen(false)
      triggerRef.current?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      buttons[(current + step + buttons.length) % buttons.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      setMenuOpen(false)
    }
  }

  return (
    <li className="campaign-tile" data-status={status}>
      <div className="campaign-tile-top">
        <div className="campaign-tile-media">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={thumbnailAlt} loading="lazy" />
          ) : (
            <span className="campaign-tile-placeholder" aria-hidden="true">
              <PackageIcon />
            </span>
          )}
        </div>
        <div className="campaign-tile-identity">
          <h3 className="campaign-tile-title" title={title}>
            {title}
          </h3>
          {subtitle && <p className="campaign-tile-subtitle">{subtitle}</p>}
          <span className="campaign-tile-badge" data-tone={badge.tone}>
            <span className="campaign-tile-badge-dot" aria-hidden="true" />
            {badge.label}
          </span>
        </div>
      </div>

      <p className="campaign-tile-meta">{creativeText}</p>
      {eventText && <p className="campaign-tile-meta">{eventText}</p>}
      {message && <p className="campaign-tile-message">{message}</p>}
      {progress && (
        <div className="campaign-tile-progress">
          <progress value={progress.value} max={progress.max} aria-label={progress.label} />
          <span className="campaign-tile-progress-label">{progress.label}</span>
        </div>
      )}
      {children}

      <div className="campaign-tile-footer">
        <button
          type="button"
          className="btn-outline btn-gold campaign-tile-primary"
          onClick={primary.onClick}
          disabled={primary.disabled}
        >
          {primary.label}
        </button>
        {menuItems.length > 0 && (
          <div className="photo-menu campaign-tile-menu" ref={menuRef}>
            <button
              type="button"
              ref={triggerRef}
              className="icon-button photo-menu-trigger"
              aria-label={`More actions for ${title}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreIcon />
            </button>
            {menuOpen && (
              <ul
                id={menuId}
                className="photo-menu-list"
                role="menu"
                aria-label={`Actions for ${title}`}
                onKeyDown={onMenuKeyDown}
              >
                {menuItems.map((item) => (
                  <li key={item.key} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className={item.danger ? 'photo-menu-danger' : undefined}
                      disabled={item.disabled}
                      onClick={() => {
                        setMenuOpen(false)
                        item.onClick()
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
