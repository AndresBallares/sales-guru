import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface BusinessTab {
  id: string
  label: string
  content: ReactNode
  // Keep this tab's content mounted (hidden) after it has been shown once, so leaving the
  // tab does not throw away work in progress inside it. Without it the content is mounted
  // only while the tab is selected.
  keepMounted?: boolean
}

// Accessible tabs (the WAI-ARIA tabs pattern with automatic activation): a tablist whose
// selected tab is the only one in the tab order, arrow keys / Home / End move between tabs
// and move focus with them, and only the selected panel is mounted so a hidden panel never
// loads its data. The parent owns which tab is selected (the page keeps it in the URL hash).
export function BusinessTabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: BusinessTab[]
  selected: string
  onSelect: (id: string) => void
}) {
  const baseId = useId()
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({})
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0]
  // Tabs shown at least once: a keepMounted tab stays mounted from then on.
  const shown = useRef(new Set<string>())
  shown.current.add(active.id)

  function go(index: number) {
    const next = tabs[(index + tabs.length) % tabs.length]
    onSelect(next.id)
    buttons.current[next.id]?.focus()
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const target: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    }
    if (event.key in target) {
      event.preventDefault()
      go(target[event.key])
    }
  }

  return (
    <div className="business-tabs">
      <div role="tablist" aria-label="Sections of this business" className="business-tablist">
        {tabs.map((tab, index) => {
          const isActive = tab.id === active.id
          return (
            <button
              key={tab.id}
              ref={(node) => {
                buttons.current[tab.id] = node
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              className={isActive ? 'business-tab business-tab-active' : 'business-tab'}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {tabs.map((tab) => {
        const isActive = tab.id === active.id
        if (!isActive && !(tab.keepMounted && shown.current.has(tab.id))) return null
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${baseId}-panel-${tab.id}`}
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            hidden={!isActive}
            className="business-tabpanel"
          >
            {tab.content}
          </div>
        )
      })}
    </div>
  )
}
