import { useId, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { BuyerAvatar } from '../lib/api'
import { AVATAR_LIST_FIELDS } from '../lib/avatarFields'
import { ActionsMenu, type MenuItem } from './ActionsMenu'
import { AvatarPriorityBadge } from './AvatarPriorityBadge'
import { CustomerAvatarImage } from './CustomerAvatarImage'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  GripVerticalIcon,
  InfoIcon,
  LightbulbIcon,
  PencilIcon,
  TrashIcon,
} from './icons'

export interface AvatarCardActions {
  onEdit: () => void
  onToggleActive: () => void
  onMoveToTop: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onAskDelete: () => void
}

// One buyer avatar as a card: a portrait with its place in the priority order, a handle to
// drag it and a three-dot menu for everything else; then its name, who it buys for, whether
// it is active, a short read of who they are, what makes the product work for them and their
// main problem. View details opens every saved field in the card. Only the handle, the menu and
// View details are interactive; the rest of the card is not a button. A form or the delete
// question opens inside the card.
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
  onOpen,
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
  // Called when View details opens the card, with the avatar: the place for a full profile
  // page to hook in later. Nothing passes it yet, so View details only expands the card.
  onOpen?: (avatar: BuyerAvatar) => void
  children?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const motivation = avatar.mechanisms[0]
  const pain = avatar.primaryProblems[0]
  const detailLists = AVATAR_LIST_FIELDS.map((field) => ({
    label: field.label,
    items: avatar[field.key],
  })).filter((list) => list.items.length > 0)

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
    expanded ? 'is-expanded' : '',
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
      <div className="avatar-card-media">
        <CustomerAvatarImage name={avatar.name} src={avatar.imageUrl} />
        <div className="avatar-card-top">
          <AvatarPriorityBadge index={index} />
          <div className="avatar-card-controls">
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
        </div>
      </div>

      <div className="avatar-card-body">
        <h3 className="avatar-card-name">{avatar.name}</h3>
        <div className="avatar-card-badges">
          <span className="avatar-badge">
            {avatar.purchaseFor === 'gift' ? 'Buys for a gift' : 'Buys for themselves'}
          </span>
          <span
            className={avatar.isActive ? 'avatar-badge avatar-badge-on' : 'avatar-badge avatar-badge-off'}
          >
            {avatar.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        <p className={expanded ? 'avatar-card-who is-expanded' : 'avatar-card-who'}>{avatar.who}</p>

        {motivation && (
          <div className="avatar-insight avatar-insight-motivation">
            <span className="avatar-insight-label">
              <LightbulbIcon />
              Why it works for them
            </span>
            <p className={expanded ? 'avatar-insight-text is-expanded' : 'avatar-insight-text'}>
              {motivation}
            </p>
          </div>
        )}
        {pain && (
          <div className="avatar-insight avatar-insight-pain">
            <span className="avatar-insight-label">
              <InfoIcon />
              Primary pain point
            </span>
            <p className={expanded ? 'avatar-insight-text is-expanded' : 'avatar-insight-text'}>
              {pain}
            </p>
          </div>
        )}

        <div id={detailsId} className="avatar-details" hidden={!expanded}>
          <dl>
            {detailLists.map((list) => (
              <div key={list.label} className="avatar-detail">
                <dt>{list.label}</dt>
                <dd>
                  <ul>
                    {list.items.map((item, position) => (
                      <li key={`${position}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
            {avatar.concepts.length > 0 && (
              <div className="avatar-detail">
                <dt>Ad concepts</dt>
                <dd>
                  <ul>
                    {avatar.concepts.map((concept) => (
                      <li key={concept.slug}>
                        {concept.slug}: {concept.description}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      <div className="avatar-card-footer">
        <button
          type="button"
          className="avatar-card-details"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => {
            if (!expanded) onOpen?.(avatar)
            setExpanded((open) => !open)
          }}
        >
          {expanded ? 'Hide details' : 'View details'}
          <span className="avatar-card-details-arrow" aria-hidden="true">
            <ChevronDownIcon />
          </span>
          <span className="visually-hidden"> of {avatar.name}</span>
        </button>
      </div>

      {children}
    </li>
  )
}
