import type { ReactNode } from 'react'
import { ChevronRightIcon } from './icons'

// A neutral, full-width settings row: an icon tile, a title with a muted description,
// and either a chevron (it opens something) or a short action word ("Change"). The
// whole row is the one button. `title` and `description` are what is seen; the button's
// accessible name is `ariaLabel`, which always contains the visible title.
export function SettingRow({
  icon,
  title,
  description,
  actionText,
  ariaLabel,
  disabled = false,
  expanded,
  onClick,
}: {
  icon: ReactNode
  title: string
  description?: string
  actionText?: string
  ariaLabel: string
  disabled?: boolean
  expanded?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="setting-row"
      aria-label={ariaLabel}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="setting-row-tile" aria-hidden="true">
        {icon}
      </span>
      <span className="setting-row-text" aria-hidden="true">
        <span className="setting-row-title">{title}</span>
        {description && <span className="setting-row-description">{description}</span>}
      </span>
      {actionText ? (
        <span className="setting-row-action" aria-hidden="true">
          {actionText}
        </span>
      ) : (
        <ChevronRightIcon />
      )}
    </button>
  )
}
