import type { ReactNode } from 'react'
import { ChevronDownIcon, SearchIcon } from './researchHubIcons'

// Scrolls to a part of the results page and moves focus there, so a keyboard or
// screen-reader user lands where the eye does. Smooth scrolling only when motion is allowed.
export function jumpTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  el.focus({ preventScroll: true })
}

export function SectionHead({
  id,
  icon,
  title,
  description,
  tone = 'gold',
}: {
  id: string
  icon: ReactNode
  title: string
  description: string
  tone?: 'gold' | 'emerald' | 'amber'
}) {
  return (
    <header className="dash-head">
      <span className="dash-ico" data-tone={tone} aria-hidden="true">
        {icon}
      </span>
      <div>
        <h3 id={id} tabIndex={-1}>
          {title}
        </h3>
        <p className="dash-sub">{description}</p>
      </div>
    </header>
  )
}

// A compact search box for a list, with a live "showing N of M" line.
export function SearchField({
  id,
  label,
  value,
  onChange,
  shown,
  total,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  shown: number
  total: number
}) {
  return (
    <div className="dash-search">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <span className="dash-search-ico" aria-hidden="true">
        <SearchIcon size={16} />
      </span>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={label}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="dash-count" role="status">
        Showing {shown} of {total}
      </span>
    </div>
  )
}

// The button that opens and closes a card's longer content.
export function Expander({
  controls,
  open,
  onToggle,
  children,
}: {
  controls: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="dash-expand"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {children}
      <span className="dash-chevron" aria-hidden="true">
        <ChevronDownIcon size={16} />
      </span>
    </button>
  )
}

export function Badge({
  tone,
  icon,
  children,
}: {
  tone: 'green' | 'gold' | 'grey' | 'amber'
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <span className="dash-badge" data-tone={tone}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="dash-empty">{children}</p>
}
