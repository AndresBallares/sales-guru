import { describe, expect, it } from 'vitest'
import { angleLabel } from './creativeAngle'

describe('angleLabel', () => {
  it('names an angle "<Avatar> – <Concept>" with an en dash', () => {
    expect(
      angleLabel({ avatar: 'self_purchaser', concept: 'everyday-wear', description: 'x' }),
    ).toBe('Self-purchaser – Everyday wear')
    expect(angleLabel({ avatar: 'gift_buyer', concept: 'social-proof', description: 'x' })).toBe(
      'Gift buyer – Social proof',
    )
  })

  it('is just the concept for an older angle with no avatar', () => {
    expect(angleLabel({ avatar: null, concept: 'product-on-skin', description: 'x' })).toBe(
      'Product on skin',
    )
  })
})
