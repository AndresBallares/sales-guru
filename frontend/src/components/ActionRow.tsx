import type { ReactNode } from 'react'
import { ChevronRightIcon } from './icons'

// One row of a campaign card's action list: an icon tile, a label, a chevron.
// The primary row ("Change image" / "Change video") takes the light purple
// fill. `hint` is a short visual-only caption (aria-hidden), so the row's
// accessible name stays exactly its label.
export function ActionRow({
  icon,
  children,
  hint,
  primary = false,
  disabled = false,
  expanded,
  onClick,
}: {
  icon: ReactNode
  children: ReactNode
  hint?: string
  primary?: boolean
  disabled?: boolean
  expanded?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={primary ? 'action-row action-row-primary' : 'action-row'}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="action-row-tile" aria-hidden="true">
        {icon}
      </span>
      <span className="action-row-text">
        <span className="action-row-label">{children}</span>
        {hint && (
          <span className="action-row-hint" aria-hidden="true">
            {hint}
          </span>
        )}
      </span>
      <ChevronRightIcon />
    </button>
  )
}
