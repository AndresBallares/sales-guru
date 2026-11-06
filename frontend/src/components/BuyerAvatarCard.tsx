import { useId, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { BuyerAvatar } from '../lib/api'
import { priorityLabel } from '../lib/avatarOrder'
import { ActionsMenu, type MenuItem } from './ActionsMenu'
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, PencilIcon, TrashIcon } from './icons'

// A description longer than this gets a Show more button; shorter ones fit in three lines.
// The whole text is always in the page, the card only clamps how much of it shows.
const LONG_DESCRIPTION = 170

export interface AvatarCardActions {
  onEdit: () => void
  onToggleActive: () => void
  onMoveToTop: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onAskDelete: () => void
}

// One buyer avatar as a card: its place in the priority order, a handle to drag it, a
// three-dot menu for everything else, then its name, who it buys for, whether it is active
// and a short read of who they are. A form or the delete question opens inside the card.
export function BuyerAvatarCard({
  avatar,
  index,
  total,
  busy,
  editing,
  dragging,
  over,
  armed,
  actions,
  hintId,
  onArm,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onHandleKey,
  children,
}: {
  avatar: BuyerAvatar
  index: number
  total: number
  busy: boolean
  editing: boolean
  dragging: boolean
  over: boolean
  // True once the handle was pressed: only then is the card draggable, so a drag can
  // never start from the text, the menu or the form.
  armed: boolean
  actions: AvatarCardActions
  hintId: string
  onArm: () => void
  onDragStart: (event: DragEvent<HTMLLIElement>) => void
  onDragOver: (event: DragEvent<HTMLLIElement>) => void
  onDrop: (event: DragEvent<HTMLLIElement>) => void
  onDragEnd: () => void
  onHandleKey: (event: KeyboardEvent<HTMLButtonElement>) => void
  children?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const whoId = useId()
  const long = avatar.who.length > LONG_DESCRIPTION

  const items: MenuItem[] = [
    { key: 'edit', label: 'Edit avatar', icon: <PencilIcon />, disabled: busy, onClick: actions.onEdit },
    {
      key: 'active',
      label: avatar.isActive ? 'Deactivate avatar' : 'Activate avatar',
      disabled: busy,
      onClick: actions.onToggleActive,
    },
    {
      key: 'top',
      label: 'Move to top',
      icon: <ArrowUpIcon />,
      disabled: busy || index === 0,
      onClick: actions.onMoveToTop,
    },
    {
      key: 'up',
      label: 'Move up',
      icon: <ArrowUpIcon />,
      disabled: busy || index === 0,
      onClick: actions.onMoveUp,
    },
    {
      key: 'down',
      label: 'Move down',
      icon: <ArrowDownIcon />,
      disabled: busy || index === total - 1,
      onClick: actions.onMoveDown,
    },
    {
      key: 'delete',
      label: 'Delete avatar',
      icon: <TrashIcon />,
      danger: true,
      disabled: busy,
      onClick: actions.onAskDelete,
    },
  ]

  const classes = [
    'avatar-card',
    avatar.isActive ? '' : 'is-inactive',
    editing ? 'is-editing' : '',
    dragging ? 'is-dragging' : '',
    over ? 'is-over' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    // Dragging is a pointer-only extra: the handle's arrow keys and the menu do the same job.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      className={classes}
      aria-label={avatar.name}
      data-avatar-item={avatar.id}
      tabIndex={-1}
      draggable={armed}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="avatar-card-top">
        <span className="avatar-card-rank">{priorityLabel(index)}</span>
        <button
          type="button"
          className="avatar-card-handle"
          data-handle={avatar.id}
          aria-label={`Reorder ${avatar.name}, position ${index + 1} of ${total}`}
          aria-describedby={hintId}
          aria-disabled={busy}
          onPointerDown={onArm}
          onKeyDown={onHandleKey}
        >
          <GripVerticalIcon />
        </button>
        <ActionsMenu label={avatar.name} items={items} />
      </div>

      <h3 className="avatar-card-name">{avatar.name}</h3>
      <div className="avatar-card-badges">
        <span className="avatar-badge">
          {avatar.purchaseFor === 'gift' ? 'Buys for a gift' : 'Buys for themselves'}
        </span>
        <span className={avatar.isActive ? 'avatar-badge avatar-badge-on' : 'avatar-badge avatar-badge-off'}>
          {avatar.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <p
        id={whoId}
        className={expanded ? 'avatar-card-who is-expanded' : 'avatar-card-who'}
      >
        {avatar.who}
      </p>
      {long && (
        <button
          type="button"
          className="avatar-card-more"
          aria-expanded={expanded}
          aria-controls={whoId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Show less' : 'Show more'}
          <span className="visually-hidden"> of {avatar.name}</span>
        </button>
      )}

      {children}
    </li>
  )
}
