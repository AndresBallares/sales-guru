// Mirrors the backend's carousel card limits (app/schemas/creative.py).
export const MIN_CAROUSEL_CARDS = 2
export const MAX_CAROUSEL_CARDS = 10

// A copy of `items` with the element at `from` moved to index `to`.
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
