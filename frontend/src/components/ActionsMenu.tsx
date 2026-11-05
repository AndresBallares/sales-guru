import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MoreIcon } from './icons'

export interface MenuItem {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

// A three-dot button that opens a small menu of actions for one card ("More actions for
// <label>"). Arrow keys, Home and End move between the items, Escape closes the menu and
// returns focus to the button, and a click anywhere else closes it. The first action takes
// focus when the menu opens. Shared by the campaign tiles and the product cards.
export function ActionsMenu({ label, items }: { label: string; items: MenuItem[] }) {
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
    <div className="photo-menu actions-menu" ref={menuRef}>
      <button
        type="button"
        ref={triggerRef}
        className="icon-button photo-menu-trigger"
        aria-label={`More actions for ${label}`}
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
          aria-label={`Actions for ${label}`}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
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
  )
}
