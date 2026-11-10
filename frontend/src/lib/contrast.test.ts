import { describe, expect, it } from 'vitest'
import { contrastRatio, mixHex } from './contrast'

describe('contrastRatio (WCAG 2 relative luminance)', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#2563EB', '#2563EB')).toBeCloseTo(1, 5)
  })

  it('does not depend on which colour is passed first', () => {
    expect(contrastRatio('#2563EB', '#E8F0FF')).toBeCloseTo(contrastRatio('#E8F0FF', '#2563EB'), 8)
  })

  it('matches the figures worked out for the dashboard palette', () => {
    expect(contrastRatio('#2563EB', '#E8F0FF')).toBeCloseTo(4.51, 2)
    expect(contrastRatio('#B7791F', '#FFF2D8')).toBeCloseTo(3.28, 2)
    expect(contrastRatio('#F59E0B', '#FFFFFF')).toBeCloseTo(2.15, 2)
  })

  it('accepts lower-case and the short or long form of a hex colour', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5)
    expect(contrastRatio('ffffff', '000000')).toBeCloseTo(21, 5)
  })
})

describe('mixHex', () => {
  it('puts a share of one colour over another', () => {
    expect(mixHex('#FFFFFF', '#000000', 0.5)).toBe('#808080')
    expect(mixHex('#FF0000', '#0000FF', 1)).toBe('#FF0000')
    expect(mixHex('#FF0000', '#0000FF', 0)).toBe('#0000FF')
  })
})
