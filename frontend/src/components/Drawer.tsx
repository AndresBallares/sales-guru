import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './icons'

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

// A panel that slides in from the right over a dimmed page: a modal dialog with a heading,
// a supporting line, a close button and a scrolling body. The page behind it cannot be used
// (the overlay covers it, Tab stays inside, and it does not scroll). Focus moves to the first
// field when it opens and goes back to whatever opened it when it closes. Escape, the X and a
// click on the overlay all call `onRequestClose`, which decides whether to close (a form with
// unsaved changes asks first). The drawer is mounted only while it is open.
export function Drawer({
  title,
  description,
  onRequestClose,
  returnFocus,
  children,
}: {
  title: string
  description: string
  onRequestClose: () => void
  // Where focus goes when the drawer closes, when that is not simply the element that had it
  // (a menu item that has since closed, for example). Defaults to the element that opened it.
  returnFocus?: () => HTMLElement | null
  children: ReactNode
}) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onRequestClose)
  closeRef.current = onRequestClose
  const returnFocusRef = useRef(returnFocus)
  returnFocusRef.current = returnFocus

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const panel = panelRef.current
    const firstField = panel?.querySelector<HTMLElement>(
      'input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
    )
    ;(firstField ?? panel?.querySelector<HTMLElement>(FOCUSABLE))?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      const target = returnFocusRef.current?.() ?? opener
      if (target?.isConnected) target.focus()
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      // An open "discard changes?" question handles its own Escape.
      if (event.defaultPrevented) return
      event.preventDefault()
      closeRef.current()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="drawer-root" onKeyDown={onKeyDown}>
      {/* A click target for mouse users only: keyboard users close with Escape or the X. */}
      <div
        className="drawer-overlay"
        role="presentation"
        data-testid="drawer-overlay"
        onClick={() => closeRef.current()}
      />
      <div
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={panelRef}
      >
        <header className="drawer-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId} className="drawer-description">
              {description}
            </p>
          </div>
          <button
            type="button"
            className="icon-button drawer-close"
            aria-label="Close"
            onClick={() => closeRef.current()}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
