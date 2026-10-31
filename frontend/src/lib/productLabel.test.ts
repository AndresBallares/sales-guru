import { describe, expect, it } from 'vitest'
import { productLabel } from './productLabel'

describe('productLabel', () => {
  it('shows the name the owner typed', () => {
    expect(productLabel({ name: 'Geo Ring', description: 'A long description' })).toBe('Geo Ring')
  })

  it('shows the description while there is no name', () => {
    expect(productLabel({ name: null, description: 'A long description' })).toBe(
      'A long description',
    )
    expect(productLabel({ description: 'A long description' })).toBe('A long description')
  })

  it('treats a blank name as no name', () => {
    expect(productLabel({ name: '   ', description: 'A long description' })).toBe(
      'A long description',
    )
  })
})
