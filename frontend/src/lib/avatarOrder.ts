// Pure helpers for the order of the buyer avatars. The order is a priority: the number on a
// card is the avatar's place in the list the server keeps, counted from 1.

// A copy of `items` with the one at `from` moved to `to`. Positions outside the list change
// nothing, so a stray drop can never lose or duplicate an avatar.
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const inside = (n: number) => Number.isInteger(n) && n >= 0 && n < items.length
  if (!inside(from) || !inside(to) || from === to) return [...items]
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// The two-digit priority shown on a card: index 0 is "01".
export function priorityLabel(index: number): string {
  return String(index + 1).padStart(2, '0')
}

// How many of the highest-priority avatars the cards highlight: a creative test's first round
// uses four different avatars, so the top four are the ones that can run first.
export const TOP_PRIORITY_COUNT = 4

// Whether the avatar at this place in the priority order is one of the top ones.
export function isTopPriority(index: number): boolean {
  return index >= 0 && index < TOP_PRIORITY_COUNT
}
