import { describe, expect, it } from 'vitest'
import { ADS_LOCKED_NOTE, isPublished } from './publishedCampaign'

describe('isPublished', () => {
  it('is true once the campaign has a Meta campaign id, whatever its status', () => {
    expect(isPublished({ metaCampaignId: 'meta_1' })).toBe(true)
  })

  it('is false without a Meta campaign id, or without a campaign', () => {
    expect(isPublished({ metaCampaignId: null })).toBe(false)
    expect(isPublished(null)).toBe(false)
  })

  it('has the message the server sends', () => {
    expect(ADS_LOCKED_NOTE).toBe(
      'This campaign is already published. Create a new campaign to change its ads.',
    )
  })
})
