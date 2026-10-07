import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPublishPaused, getPublishPaused, setPublishPaused } from './publishPaused'

afterEach(() => {
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('publishPaused', () => {
  it('defaults to paused (checked) when the user has not chosen', () => {
    expect(getPublishPaused('camp-1')).toBe(true)
  })

  it('remembers an explicit choice, per campaign', () => {
    setPublishPaused('camp-1', false)

    expect(getPublishPaused('camp-1')).toBe(false)
    expect(getPublishPaused('camp-2')).toBe(true)
  })

  it('can remember a choice to stay paused too', () => {
    setPublishPaused('camp-1', false)
    setPublishPaused('camp-1', true)

    expect(getPublishPaused('camp-1')).toBe(true)
  })

  it('forgets the choice once cleared, so the next publish defaults to paused again', () => {
    setPublishPaused('camp-1', false)

    clearPublishPaused('camp-1')

    expect(getPublishPaused('camp-1')).toBe(true)
  })

  it('falls back to paused when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(getPublishPaused('camp-1')).toBe(true)
    expect(() => setPublishPaused('camp-1', false)).not.toThrow()
    expect(() => clearPublishPaused('camp-1')).not.toThrow()
  })

  it('ignores a corrupt stored value', () => {
    window.sessionStorage.setItem('publishPaused:camp-1', 'banana')

    expect(getPublishPaused('camp-1')).toBe(true)
  })
})
