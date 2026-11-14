import { describe, expect, it } from 'vitest'
import { monogram, portraitHue } from './avatarPortrait'

describe('monogram', () => {
  it('takes the first letters of the first two meaningful words', () => {
    expect(monogram('The Promotion Ring Buyer')).toBe('PR')
    expect(monogram('The Mother-to-Daughter Milestone Gifter')).toBe('MT')
    expect(monogram('Ann Lee')).toBe('AL')
  })

  it('works with one word, lower case and accents', () => {
    expect(monogram('Heirloom')).toBe('H')
    expect(monogram('élan vital')).toBe('ÉV')
  })

  it('uses a skipped word when nothing else is left, and a question mark for nothing', () => {
    expect(monogram('The')).toBe('T')
    expect(monogram('  ')).toBe('?')
    expect(monogram('!!!')).toBe('?')
  })
})

describe('portraitHue', () => {
  it('is the same for the same name and always a valid hue', () => {
    expect(portraitHue('The Promotion Ring Buyer')).toBe(portraitHue('The Promotion Ring Buyer'))
    for (const name of ['', 'a', 'The Wearable-Sculpture Buyer', '😀 emoji']) {
      const hue = portraitHue(name)
      expect(Number.isInteger(hue)).toBe(true)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('differs between different names', () => {
    expect(portraitHue('The Promotion Ring Buyer')).not.toBe(portraitHue('The Heirloom Commissioner'))
  })
})
