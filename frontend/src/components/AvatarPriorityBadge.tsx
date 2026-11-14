import { isTopPriority, priorityLabel } from '../lib/avatarOrder'

// An avatar's place in the priority order as a badge: highlighted for the top few (the ones a
// first round can use), neutral for the rest. The place is the order the user set, not a guess.
export function AvatarPriorityBadge({ index }: { index: number }) {
  const top = isTopPriority(index)
  return (
    <span className={top ? 'avatar-priority is-top' : 'avatar-priority'}>
      Priority <span className="avatar-priority-num">{priorityLabel(index)}</span>
      {top && <span className="visually-hidden"> (top audience)</span>}
    </span>
  )
}
