import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { moveItem } from '../lib/carousel'
import { ASPECT_CLASS_LABELS, formatDuration, type AspectClass } from '../lib/media'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  InfoIcon,
  MoreIcon,
  StarIcon,
  TrashIcon,
} from './icons'

export interface PhotoItem {
  id: string
  // The thumbnail to show (a video's captured frame) and the full file to open.
  src: string
  fullSrc?: string
  isVideo: boolean
  // The file name when it is known (photos still waiting to be saved); saved
  // photos have none, so they are called "Image 1", "Image 2", ...
  name?: string
  aspectClass?: AspectClass | null
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  // The upload flagged this one (it is shaped outside the usual ad shapes).
  warned?: boolean
}

// The product photos as a vertical list: a drag handle, a thumbnail, the name and
// its metadata with a "Primary image" badge, "Set primary", and an overflow menu
// (Move up, Move down, Remove). The first image is the primary one (that is the
// existing rule: the backend only knows the order), so "Set primary" moves an image
// to the top through the same reorder call.
//
// Reordering never depends on dragging: the handle also takes the arrow keys, and the
// menu has Move up / Move down (native drag-and-drop does not work on touch screens).
// Changes are announced through a polite live region.
export function PhotoList({
  items,
  busy = false,
  removingId = null,
  onReorder,
  onRemove,
  onEmptied,
}: {
  items: PhotoItem[]
  // A reorder or removal request is in flight.
  busy?: boolean
  removingId?: string | null
  onReorder: (orderedIds: string[]) => Promise<void> | void
  onRemove: (id: string) => Promise<void> | void
  // Called after the last image was removed, so focus can move somewhere sensible.
  onEmptied?: () => void
}) {
  const hintId = useId()
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const handleRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const menuTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const listRef = useRef<HTMLUListElement>(null)

  const canEdit = !busy && removingId === null
  const total = items.length
  const label = (index: number) => `${items[index].isVideo ? 'Video' : 'Image'} ${index + 1}`

  // Close an open menu when the user clicks or taps anywhere outside it.
  useEffect(() => {
    if (openMenuId === null) return
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return
      if (!listRef.current?.querySelector('[data-open-menu]')?.contains(event.target)) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [openMenuId])

  function focusLater(kind: 'handle' | 'menu', id: string) {
    setTimeout(() => {
      const refs = kind === 'handle' ? handleRefs.current : menuTriggerRefs.current
      refs[id]?.focus()
    }, 0)
  }

  async function reorder(
    orderedIds: string[],
    message: string,
    focus: { kind: 'handle' | 'menu'; id: string },
  ) {
    await onReorder(orderedIds)
    // Whatever the outcome, focus stays on (or returns to) the control that was used.
    focusLater(focus.kind, focus.id)
    setAnnouncement(message)
  }

  function ids() {
    return items.map((item) => item.id)
  }

  function move(index: number, to: number, kind: 'handle' | 'menu') {
    if (!canEdit || to < 0 || to >= total || to === index) return
    void reorder(
      moveItem(ids(), index, to),
      `${label(index)} moved to position ${to + 1} of ${total}.`,
      { kind, id: items[index].id },
    )
  }

  function setPrimary(index: number) {
    if (!canEdit || index === 0) return
    void reorder(moveItem(ids(), index, 0), `${label(index)} is now the primary image.`, {
      kind: 'menu',
      id: items[index].id,
    })
  }

  async function remove(index: number) {
    if (!canEdit) return
    const next = items[index + 1] ?? items[index - 1]
    const name = label(index)
    const wasPrimary = index === 0
    setOpenMenuId(null)
    await onRemove(items[index].id)
    setAnnouncement(
      `${name} removed.${wasPrimary && next ? ' The next image is now the primary image.' : ''}`,
    )
    if (next) focusLater('menu', next.id)
    else onEmptied?.()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      move(index, index + (event.key === 'ArrowDown' ? 1 : -1), 'handle')
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, toId: string) {
    event.preventDefault()
    const from = items.findIndex((item) => item.id === dragId)
    const to = items.findIndex((item) => item.id === toId)
    setDragId(null)
    setOverId(null)
    if (from === -1 || to === -1 || from === to || !canEdit) return
    void reorder(
      moveItem(ids(), from, to),
      `${label(from)} moved to position ${to + 1} of ${total}.`,
      { kind: 'handle', id: items[from].id },
    )
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLUListElement>, id: string) {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    )
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpenMenuId(null)
      menuTriggerRefs.current[id]?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      buttons[(current + step + buttons.length) % buttons.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      setOpenMenuId(null)
    }
  }

  function toggleMenu(id: string) {
    setOpenMenuId((open) => (open === id ? null : id))
    // Put focus on the first available action once the menu has rendered.
    setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>('[data-open-menu] [role="menuitem"]:not(:disabled)')
        ?.focus()
    }, 0)
  }

  const knownClasses = new Set(items.map((item) => item.aspectClass).filter(Boolean))
  const differentShapes = knownClasses.size > 1
  const unusualShape = items.some((item) => item.aspectClass === 'UNCLASSIFIED' || item.warned)
  const showCropNotice = differentShapes || unusualShape

  return (
    <>
      <p id={hintId} className="visually-hidden">
        To reorder, drag a handle, or focus it and press the up or down arrow key.
      </p>
      <output className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </output>
      <ul className="photo-list" aria-label="Uploaded product photos" ref={listRef}>
        {items.map((item, index) => {
          const isPrimary = index === 0
          const name = label(index)
          const menuOpen = openMenuId === item.id
          const meta = [
            item.aspectClass ? ASPECT_CLASS_LABELS[item.aspectClass] : null,
            item.width && item.height ? `${item.width} × ${item.height}` : null,
            item.isVideo && item.durationSeconds != null
              ? formatDuration(item.durationSeconds)
              : null,
          ].filter(Boolean)
          return (
            <li key={item.id} className={isPrimary ? 'photo-row photo-row-primary' : 'photo-row'}>
              <div
                role="presentation"
                className={[
                  'photo-row-drag',
                  dragId === item.id ? 'is-dragging' : '',
                  overId === item.id && dragId !== item.id ? 'is-over' : '',
                ]
                  .join(' ')
                  .trim()}
                draggable={canEdit}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', item.id)
                  event.dataTransfer.effectAllowed = 'move'
                  setDragId(item.id)
                }}
                onDragOver={(event) => {
                  if (dragId === null) return
                  event.preventDefault()
                  setOverId(item.id)
                }}
                onDrop={(event) => handleDrop(event, item.id)}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
              >
                <button
                  type="button"
                  className="photo-handle"
                  aria-label={`Reorder ${name}`}
                  aria-describedby={hintId}
                  disabled={!canEdit}
                  ref={(node) => {
                    handleRefs.current[item.id] = node
                  }}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <GripVerticalIcon />
                </button>
                <a
                  className="photo-row-thumb"
                  href={item.fullSrc ?? item.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View ${name} full size (opens in a new tab)`}
                >
                  <img src={item.src} alt={name} draggable={false} />
                </a>
                <div className="photo-row-info">
                  <p className="photo-row-name">{item.name ?? name}</p>
                  {isPrimary && (
                    <p className="photo-row-badge">
                      <StarIcon />
                      Primary image
                    </p>
                  )}
                  {meta.length > 0 && <p className="photo-row-meta">{meta.join(' · ')}</p>}
                </div>
                <div className="photo-row-actions">
                  {!isPrimary && (
                    <button
                      type="button"
                      className="btn-outline photo-set-primary"
                      aria-label={`Set primary for ${name}`}
                      disabled={!canEdit}
                      onClick={() => setPrimary(index)}
                    >
                      Set primary
                    </button>
                  )}
                  <div className="photo-menu" {...(menuOpen ? { 'data-open-menu': true } : {})}>
                    <button
                      type="button"
                      className="icon-button photo-menu-trigger"
                      aria-label={`More actions for ${name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      disabled={!canEdit}
                      ref={(node) => {
                        menuTriggerRefs.current[item.id] = node
                      }}
                      onClick={() => toggleMenu(item.id)}
                    >
                      <MoreIcon />
                    </button>
                    {menuOpen && (
                      <ul
                        className="photo-menu-list"
                        role="menu"
                        aria-label={`Actions for ${name}`}
                        onKeyDown={(event) => handleMenuKeyDown(event, item.id)}
                      >
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={index === 0}
                            onClick={() => {
                              setOpenMenuId(null)
                              move(index, index - 1, 'menu')
                            }}
                          >
                            <ArrowUpIcon />
                            Move up
                          </button>
                        </li>
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={index === total - 1}
                            onClick={() => {
                              setOpenMenuId(null)
                              move(index, index + 1, 'menu')
                            }}
                          >
                            <ArrowDownIcon />
                            Move down
                          </button>
                        </li>
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            className="photo-menu-danger"
                            onClick={() => void remove(index)}
                          >
                            <TrashIcon size={18} />
                            {removingId === item.id ? 'Removing…' : 'Remove'}
                          </button>
                        </li>
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {showCropNotice && (
        <div className="photo-notice">
          <InfoIcon />
          <div>
            <p className="photo-notice-title">
              Some images may be cropped in certain ad placements.
            </p>
            <p>
              {differentShapes
                ? 'Your uploaded images have different aspect ratios. Some placements may crop them to fit. Preview the available formats before publishing to make sure important content remains visible.'
                : "An uploaded image doesn't match one of the standard ad shapes. Some placements may crop it to fit. Preview the available formats before publishing to make sure important content remains visible."}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
