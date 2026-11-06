import { describe, expect, it } from 'vitest'
import { moveItem, priorityLabel } from './avatarOrder'

describe('moveItem', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('moves an item down to a later position', () => {
    expect(moveItem(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item up to an earlier position', () => {
    expect(moveItem(ids, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves an item to the top', () => {
    expect(moveItem(ids, 2, 0)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('leaves the list as it is when nothing moves', () => {
    expect(moveItem(ids, 1, 1)).toEqual(ids)
  })

  it('returns a new array and never changes the one it was given', () => {
    const copy = [...ids]
    const moved = moveItem(ids, 0, 3)

    expect(ids).toEqual(copy)
    expect(moved).not.toBe(ids)
  })

  it('ignores positions outside the list', () => {
    expect(moveItem(ids, -1, 2)).toEqual(ids)
    expect(moveItem(ids, 0, 4)).toEqual(ids)
    expect(moveItem(ids, 4, 0)).toEqual(ids)
  })
})

describe('priorityLabel', () => {
  it('shows the position with two digits', () => {
    expect(priorityLabel(0)).toBe('01')
    expect(priorityLabel(8)).toBe('09')
    expect(priorityLabel(11)).toBe('12')
  })
})
