import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { Business, Creative } from '../lib/api'
import { MIN_CAROUSEL_CARDS, moveItem } from '../lib/carousel'
import { GripIcon } from './icons'
import { SocialPostPreview } from './SocialPostPreview'

// The one carousel editor (campaign card and ad page): a large preview of the
// selected slide as it will appear in the ad, a compact thumbnail rail under
// it, and a small action row for the selected slide. Selection follows a slide
// by id, so it stays with its image across reorders and removals.
//
// Reordering: drag a thumbnail within the rail, or use Move earlier / Move
// later (also Alt+Arrow on the rail), which also covers touch screens where
// native drag-and-drop is unavailable. The backend has no endpoint for adding a
// card or editing a card's text, so those aren't offered here.
export function CarouselEditor({
  business,
  creative,
  ctaLabel,
  busy,
  locked = false,
  error,
  onReorder,
  onRemove,
}: {
  business?: Business | null
  creative: Creative
  ctaLabel: string
  // A card request is in flight.
  busy: boolean
  // A published ad: browse only, no edits.
  locked?: boolean
  error?: string | null
  onReorder: (cardIds: string[]) => Promise<void> | void
  onRemove: (cardId: string) => Promise<void> | void
}) {
  const cards = creative.cards
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  // Where selection lands once the selected slide has been removed.
  const [fallbackId, setFallbackId] = useState<string | null>(null)
  const thumbs = useRef<Record<string, HTMLButtonElement | null>>({})
  // Screen-reader announcements: what was last moved, what we last announced.
  const [movedId, setMovedId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [seen, setSeen] = useState<{ order: string; selected: string } | null>(null)

  if (cards.length === 0) return null

  const found = cards.findIndex((card) => card.id === selectedId)
  const fallback = cards.findIndex((card) => card.id === fallbackId)
  const selectedIndex = found !== -1 ? found : fallback !== -1 ? fallback : 0
  const selected = cards[selectedIndex]
  const total = cards.length
  const canEdit = !locked && !busy && removingId === null
  const atMinimum = total <= MIN_CAROUSEL_CARDS

  // Announce a change in the slide order, the slide count or the selected slide
  // (derived during render, so it follows whatever the parent saved).
  const order = cards.map((card) => card.id).join(',')
  if (seen === null) {
    setSeen({ order, selected: selected.id })
  } else if (seen.order !== order || seen.selected !== selected.id) {
    const previousCount = seen.order.split(',').length
    const movedIndex = cards.findIndex((card) => card.id === movedId)
    let message = `Slide ${selectedIndex + 1} of ${total}: ${selected.headline}.`
    if (total < previousCount) {
      message = `Slide removed. Showing slide ${selectedIndex + 1} of ${total}: ${selected.headline}.`
    } else if (seen.order !== order && movedIndex !== -1) {
      message = `${cards[movedIndex].headline} moved to position ${movedIndex + 1} of ${total}.`
    }
    setSeen({ order, selected: selected.id })
    setAnnouncement(message)
  }

  function select(index: number, focus = false) {
    const card = cards[Math.min(Math.max(index, 0), total - 1)]
    setSelectedId(card.id)
    if (focus) thumbs.current[card.id]?.focus()
  }

  function move(from: number, to: number) {
    if (!canEdit || from < 0 || from >= total || to < 0 || to >= total || from === to) return
    setMovedId(cards[from].id)
    void onReorder(moveItem(cards, from, to).map((card) => card.id))
  }

  async function remove() {
    if (!canEdit || atMinimum) return
    // Land on the next slide, or the previous one when removing the last.
    const neighbor = cards[selectedIndex + 1] ?? cards[selectedIndex - 1]
    setSelectedId(selected.id)
    setFallbackId(neighbor.id)
    setRemovingId(selected.id)
    try {
      await onRemove(selected.id)
    } finally {
      setRemovingId(null)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      if (event.key === 'Home') select(0, true)
      else if (event.key === 'End') select(total - 1, true)
      else return
      event.preventDefault()
      return
    }
    event.preventDefault()
    const step = event.key === 'ArrowRight' ? 1 : -1
    if (event.altKey) {
      // The moved slide stays selected (selection is by id), keep focus on it.
      move(selectedIndex, selectedIndex + step)
      return
    }
    select(selectedIndex + step, true)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, toId: string) {
    event.preventDefault()
    const from = cards.findIndex((card) => card.id === dragId)
    const to = cards.findIndex((card) => card.id === toId)
    setDragId(null)
    setOverId(null)
    move(from, to)
  }

  return (
    <div className="carousel-editor">
      <div className="carousel-header">
        <h4>Carousel preview</h4>
        <p>
          Slide {selectedIndex + 1} of {total}
        </p>
      </div>

      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <SocialPostPreview
        business={business}
        creative={creative}
        ctaLabel={ctaLabel}
        activeCard={selectedIndex}
      />

      <ul className="carousel-rail" aria-label="Carousel slides">
        {cards.map((card, index) => {
          const isSelected = card.id === selected.id
          return (
            <li key={card.id}>
              <div
                role="presentation"
                className={[
                  'carousel-drag',
                  dragId === card.id ? 'is-dragging' : '',
                  overId === card.id && dragId !== card.id ? 'is-over' : '',
                ]
                  .join(' ')
                  .trim()}
                draggable={canEdit}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', card.id)
                  event.dataTransfer.effectAllowed = 'move'
                  setDragId(card.id)
                }}
                onDragOver={(event) => {
                  if (dragId === null) return
                  event.preventDefault()
                  setOverId(card.id)
                }}
                onDrop={(event) => handleDrop(event, card.id)}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
              >
                <button
                  type="button"
                  className="carousel-thumb"
                  ref={(node) => {
                    thumbs.current[card.id] = node
                  }}
                  aria-label={`Slide ${index + 1} of ${total}: ${card.headline}`}
                  aria-current={isSelected ? 'true' : undefined}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => select(index)}
                  onKeyDown={handleKeyDown}
                >
                  <img src={card.imageUrl} alt="" draggable={false} />
                  <span className="carousel-thumb-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  {canEdit && (
                    <span className="carousel-thumb-grip" aria-hidden="true">
                      <GripIcon />
                    </span>
                  )}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {!locked && (
        <div className="carousel-actions">
          <button
            type="button"
            className="button-quiet"
            onClick={() => move(selectedIndex, selectedIndex - 1)}
            disabled={!canEdit || selectedIndex === 0}
          >
            Move earlier
          </button>
          <button
            type="button"
            className="button-quiet"
            onClick={() => move(selectedIndex, selectedIndex + 1)}
            disabled={!canEdit || selectedIndex === total - 1}
          >
            Move later
          </button>
          <button
            type="button"
            className="link-button carousel-remove"
            onClick={() => void remove()}
            disabled={!canEdit || atMinimum}
          >
            {removingId !== null ? 'Removing…' : `Remove slide ${selectedIndex + 1}`}
          </button>
        </div>
      )}
      {!locked && atMinimum && (
        <p className="field-hint">A carousel needs at least {MIN_CAROUSEL_CARDS} slides.</p>
      )}

      <div
        className="carousel-details"
        role="group"
        aria-label={`Slide ${selectedIndex + 1} details`}
      >
        <p className="carousel-details-headline">{selected.headline}</p>
        {selected.description && (
          <p className="carousel-details-description">{selected.description}</p>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
