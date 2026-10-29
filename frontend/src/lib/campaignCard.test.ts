import { describe, expect, it } from 'vitest'
import {
  cardModel,
  creativeCountText,
  draftSetupProgress,
  setupStepStatus,
  type CardInput,
} from './campaignCard'

function input(overrides: Partial<CardInput> = {}): CardInput {
  return {
    status: 'DRAFT',
    fallbackStatusLabel: 'Something',
    isPublishing: false,
    generating: null,
    isActivatable: false,
    pausedReason: null,
    adSelection: null,
    setup: null,
    ...overrides,
  }
}

describe('creativeCountText', () => {
  it('says "No creatives yet" for zero', () => {
    expect(creativeCountText(0)).toBe('No creatives yet')
  })

  it('uses the singular for one and the plural otherwise', () => {
    expect(creativeCountText(1)).toBe('1 creative')
    expect(creativeCountText(4)).toBe('4 creatives')
  })

  it('shows a loading state, never zero, while the count is unknown', () => {
    expect(creativeCountText(null)).toBe('Loading creatives…')
  })

  it('says so when the creatives could not be loaded', () => {
    expect(creativeCountText(null, true)).toBe('Creatives unavailable')
    expect(creativeCountText(3, true)).toBe('Creatives unavailable')
  })
})

describe('setup progress', () => {
  it('counts the objective as done, then the product and audience', () => {
    expect(setupStepStatus({ productId: null, audienceId: null })).toEqual({
      objective: true,
      product: false,
      audience: false,
    })
    expect(draftSetupProgress({ productId: null, audienceId: null })).toEqual({
      done: 1,
      total: 3,
      next: 'Choose a product',
    })
    expect(draftSetupProgress({ productId: 'p', audienceId: null })).toEqual({
      done: 2,
      total: 3,
      next: 'Attach an audience',
    })
    expect(draftSetupProgress({ productId: 'p', audienceId: 'a' })).toEqual({
      done: 3,
      total: 3,
      next: null,
    })
  })
})

describe('cardModel', () => {
  it('shows a draft with a real setup progress bar and "Continue setup"', () => {
    const model = cardModel(
      input({ status: 'DRAFT', setup: { done: 2, total: 3, next: 'Attach an audience' } }),
    )

    expect(model.badge).toEqual({ label: 'Draft', tone: 'neutral' })
    expect(model.message).toBe('Next: Attach an audience')
    expect(model.progress).toEqual({ value: 2, max: 3, label: '2 of 3 setup steps done' })
    expect(model.primary).toEqual({ kind: 'open', label: 'Continue setup' })
  })

  it('has no progress bar for a draft whose setup state is unknown', () => {
    expect(cardModel(input({ status: 'DRAFT', setup: null })).progress).toBeNull()
  })

  it('says a campaign with complete setup is ready for its strategy', () => {
    const model = cardModel(input({ status: 'READY' }))

    expect(model.badge).toEqual({ label: 'Ready for strategy', tone: 'info' })
    expect(model.message).toBe('Setup is complete. Next: generate your strategy.')
    expect(model.progress).toBeNull()
    expect(model.primary).toEqual({ kind: 'open', label: 'Continue setup' })
  })

  it('says a strategy is ready and that ads are next, without a progress bar', () => {
    const model = cardModel(input({ status: 'STRATEGY_GENERATED' }))

    expect(model.badge.label).toBe('Strategy ready')
    expect(model.message).toBe('Next: generate your ads.')
    expect(model.progress).toBeNull()
    expect(model.primary.label).toBe('Continue setup')
  })

  it('asks for a review when ads are generated, with progress only for a creative test', () => {
    const test = cardModel(
      input({ status: 'ADS_GENERATED', adSelection: { selected: 2, required: 4 } }),
    )
    expect(test.badge).toEqual({ label: 'Needs your review', tone: 'attention' })
    expect(test.message).toBe('Choose the ads to run in this test.')
    expect(test.progress).toEqual({ value: 2, max: 4, label: '2 of 4 ads chosen' })
    expect(test.primary.label).toBe('Review campaign')

    const single = cardModel(input({ status: 'ADS_GENERATED', adSelection: null }))
    expect(single.progress).toBeNull()
    expect(single.message).toBe('Choose the ad you want to run.')
  })

  it('never lets the progress value exceed its maximum', () => {
    const model = cardModel(
      input({ status: 'ADS_GENERATED', adSelection: { selected: 5, required: 4 } }),
    )
    expect(model.progress?.value).toBe(4)
  })

  it.each(['PENDING_APPROVAL', 'APPROVED'])('calls %s "Ready to publish"', (status) => {
    const model = cardModel(input({ status }))

    expect(model.badge).toEqual({ label: 'Ready to publish', tone: 'ready' })
    expect(model.primary).toEqual({ kind: 'open', label: 'Review and publish' })
    expect(model.progress).toBeNull()
  })

  it('shows publishing while a publish is running, over the stored status', () => {
    const model = cardModel(input({ status: 'PENDING_APPROVAL', isPublishing: true }))

    expect(model.badge).toEqual({ label: 'Publishing…', tone: 'busy' })
    expect(model.primary.label).toBe('View publishing status')
    expect(model.progress).toBeNull()
  })

  it('does not call a live campaign "Publishing" just because a publish flag lingers', () => {
    expect(cardModel(input({ status: 'LIVE', isPublishing: true })).badge.label).toBe('Active')
  })

  it('shows generating only while this tab is waiting, with no invented percentage', () => {
    const strategy = cardModel(input({ status: 'DRAFT', generating: 'strategy' }))
    expect(strategy.badge).toEqual({ label: 'Generating…', tone: 'busy' })
    expect(strategy.message).toBe('Generating your strategy…')
    expect(strategy.primary.label).toBe('View progress')
    expect(strategy.progress).toBeNull()

    expect(cardModel(input({ generating: 'ads' })).message).toBe('Generating your ads…')
  })

  it('calls a running campaign Active with "View campaign" and no progress', () => {
    const model = cardModel(input({ status: 'LIVE' }))

    expect(model.badge).toEqual({ label: 'Active', tone: 'success' })
    expect(model.primary).toEqual({ kind: 'open', label: 'View campaign' })
    expect(model.progress).toBeNull()
  })

  it('offers Resume only for a campaign the app paused at publish', () => {
    const resumable = cardModel(input({ status: 'PAUSED', isActivatable: true }))
    expect(resumable.badge.label).toBe('Paused')
    expect(resumable.primary).toEqual({ kind: 'resume', label: 'Resume campaign' })
    expect(resumable.message).toBe('Published paused, so it is not spending yet.')

    const other = cardModel(
      input({ status: 'PAUSED', isActivatable: false, pausedReason: 'Test ended' }),
    )
    expect(other.primary).toEqual({ kind: 'open', label: 'View campaign' })
    expect(other.message).toBe('Paused: Test ended')
  })

  it('shows a paused campaign without a reason as just paused', () => {
    expect(cardModel(input({ status: 'PAUSED' })).message).toBeNull()
  })

  it('marks a failed campaign and offers a retry', () => {
    const model = cardModel(input({ status: 'FAILED' }))

    expect(model.badge).toEqual({ label: 'Failed', tone: 'danger' })
    expect(model.primary.label).toBe('Retry publish')
  })

  it('offers to restore an archived campaign', () => {
    const model = cardModel(input({ status: 'ARCHIVED' }))

    expect(model.badge.label).toBe('Archived')
    expect(model.primary).toEqual({ kind: 'restore', label: 'Restore campaign' })
  })

  it('falls back to the options label for a status it does not know', () => {
    const model = cardModel(input({ status: 'SOMETHING_NEW', fallbackStatusLabel: 'Brand new' }))

    expect(model.badge).toEqual({ label: 'Brand new', tone: 'neutral' })
    expect(model.primary.label).toBe('View campaign')
  })

  it('uses a distinct tone for each kind of state', () => {
    const tones = new Set(
      ['DRAFT', 'STRATEGY_GENERATED', 'ADS_GENERATED', 'APPROVED', 'LIVE', 'FAILED'].map(
        (status) => cardModel(input({ status })).badge.tone,
      ),
    )
    expect(tones.size).toBeGreaterThanOrEqual(5)
  })
})
