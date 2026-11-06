import type { ReactNode } from 'react'
import { CheckIcon } from './icons'

// One choice among a few, drawn as a card: an icon, a title with a tag, a description and a
// selected mark. The real radio input sits inside the label (transparent, covering the card), so the
// whole card is the click target and the keyboard and screen readers get a radio group.
export function ResearchChoiceCard({
  name,
  value,
  checked,
  disabled = false,
  icon,
  title,
  tag,
  description,
  cost,
  note,
  onSelect,
}: {
  name: string
  value: string
  checked: boolean
  disabled?: boolean
  icon: ReactNode
  title: string
  tag: string
  description: string
  // What the server expects this choice to cost, already formatted; left out until known.
  cost?: string
  // Why the card cannot be chosen; read out with the card.
  note?: string
  onSelect: () => void
}) {
  const noteId = `${name}-${value}-note`
  return (
    <label
      className={`choice-card${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <input
        type="radio"
        className="choice-input"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-describedby={note ? noteId : undefined}
        onChange={onSelect}
      />
      <span className="choice-card-top">
        <span className="choice-card-icon">{icon}</span>
        <span className="choice-card-mark" aria-hidden="true">
          {checked && <CheckIcon />}
        </span>
      </span>
      <span className="choice-card-title">{title}</span>
      <span className="choice-card-tag">{tag}</span>
      <span className="choice-card-description">{description}</span>
      {cost && <span className="choice-card-cost">Expected {cost}</span>}
      {note && (
        <span id={noteId} className="choice-card-note">
          {note}
        </span>
      )}
    </label>
  )
}
