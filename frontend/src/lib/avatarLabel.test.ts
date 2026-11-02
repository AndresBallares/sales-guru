import { describe, expect, it } from 'vitest'
import type { Creative, DashboardAdRow } from './api'
import { adAvatarLine, avatarMarker, creativeAngleText } from './avatarLabel'
import { makeAdRow } from '../test/dashboardFixtures'

function creative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'c1',
    campaignId: 'camp',
    adId: null,
    headline: 'H',
    bodyText: 'B',
    description: '',
    cta: 'SHOP_NOW',
    creativeAngle: 'Self-purchaser – Ceramic inlay – Mechanism',
    imagePrompt: null,
    videoPrompt: null,
    imageUrl: null,
    format: 'SINGLE_IMAGE',
    cards: [],
    status: 'GENERATED',
    createdAt: '2026-11-02T00:00:00Z',
    isStale: false,
    ...overrides,
  }
}

describe('avatarMarker', () => {
  it('marks a deleted avatar archived and a deactivated one inactive', () => {
    expect(avatarMarker('archived')).toBe('archived')
    expect(avatarMarker('inactive')).toBe('inactive')
  })

  it('marks nothing for an active avatar or no avatar', () => {
    expect(avatarMarker('active')).toBeNull()
    expect(avatarMarker(null)).toBeNull()
    expect(avatarMarker(undefined)).toBeNull()
  })
})

describe('creativeAngleText', () => {
  it('leads with the avatar name, then the concept and the pillar', () => {
    const text = creativeAngleText(
      creative({
        concept: 'ceramic-inlay',
        pillar: 'mechanism',
        buyerAvatarId: 'a1',
        buyerAvatar: { id: 'a1', name: 'The Promotion Ring Buyer', state: 'active' },
      }),
    )

    expect(text).toBe('The Promotion Ring Buyer – Ceramic inlay – Mechanism')
  })

  it('leaves out a pillar the creative does not have', () => {
    const text = creativeAngleText(
      creative({
        concept: 'ceramic-inlay',
        pillar: null,
        buyerAvatar: { id: 'a1', name: 'The Collector', state: 'active' },
      }),
    )

    expect(text).toBe('The Collector – Ceramic inlay')
  })

  it('falls back to the existing angle label when there is no avatar', () => {
    expect(creativeAngleText(creative())).toBe('Self-purchaser – Ceramic inlay – Mechanism')
    expect(creativeAngleText(creative({ buyerAvatar: null }))).toBe(
      'Self-purchaser – Ceramic inlay – Mechanism',
    )
  })

  it('is empty for a creative with neither', () => {
    expect(creativeAngleText(creative({ creativeAngle: null }))).toBe('')
  })
})

describe('adAvatarLine', () => {
  it('names the avatar and the pillar', () => {
    const row: DashboardAdRow = makeAdRow({
      avatarName: 'The Deadline Gift-Giver',
      avatarState: 'active',
      pillar: 'emotion',
    })

    expect(adAvatarLine(row)).toBe('The Deadline Gift-Giver – Emotion')
  })

  it('names just the avatar when the pillar is unknown', () => {
    expect(adAvatarLine(makeAdRow({ avatarName: 'The Collector', pillar: null }))).toBe(
      'The Collector',
    )
  })

  it('is null for an ad with no avatar', () => {
    expect(adAvatarLine(makeAdRow())).toBeNull()
  })
})
