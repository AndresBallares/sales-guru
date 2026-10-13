import { describe, expect, it } from 'vitest'
import { moveItem } from './carousel'

describe('moveItem', () => {
  it('moves an element to a new index without mutating the input', () => {
    const items = ['a', 'b', 'c', 'd']

    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(items, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(items).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns the same list for a no-op or out-of-range move', () => {
    const items = ['a', 'b']

    expect(moveItem(items, 1, 1)).toBe(items)
    expect(moveItem(items, -1, 0)).toBe(items)
    expect(moveItem(items, 0, 5)).toBe(items)
  })
})
