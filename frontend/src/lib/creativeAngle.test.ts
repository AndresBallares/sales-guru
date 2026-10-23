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

  it('puts the pillar last, so the avatar part is unchanged', () => {
    expect(
      angleLabel({
        avatar: 'self_purchaser',
        concept: 'craftsmanship',
        pillar: 'mechanism',
        description: 'x',
      }),
    ).toBe('Self-purchaser – Craftsmanship – Mechanism')
    expect(
      angleLabel({
        avatar: 'gift_buyer',
        concept: 'why-gold-lasts',
        pillar: 'education',
        description: 'x',
      }),
    ).toBe('Gift buyer – Why gold lasts – Education')
  })

  it('names an angle with no pillar exactly as before', () => {
    expect(
      angleLabel({ avatar: 'gift_buyer', concept: 'gifting', pillar: null, description: 'x' }),
    ).toBe('Gift buyer – Gifting')
  })

  it('ignores a pillar on an older angle with no avatar', () => {
    expect(
      angleLabel({ avatar: null, concept: 'gifting', pillar: 'offer', description: 'x' }),
    ).toBe('Gifting')
  })
})
