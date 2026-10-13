import type { ReactNode } from 'react'
import { SpinnerIcon } from './icons'

export interface ToolbarAction {
  key: string
  // The accessible name and the tooltip.
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  // Swaps the icon for a spinner; the button is also disabled by the caller.
  busy?: boolean
  expanded?: boolean
}

// The campaign card's compact editing toolbar: small neutral icon buttons,
// each with an accessible name and a tooltip. Renders nothing when a card has
// no editing actions (e.g. a published campaign, whose ads are locked).
export function CardToolbar({ label, actions }: { label: string; actions: ToolbarAction[] }) {
  if (actions.length === 0) return null
  return (
    <div className="card-toolbar" role="group" aria-label={label}>
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          className="icon-button"
          aria-label={action.label}
          data-tooltip={action.label}
          aria-expanded={action.expanded}
          aria-busy={action.busy || undefined}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.busy ? <SpinnerIcon /> : action.icon}
        </button>
      ))}
    </div>
  )
}
