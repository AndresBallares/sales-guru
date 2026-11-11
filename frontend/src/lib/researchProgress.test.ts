import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'
import {
  HUB_PAIRS,
  hubSegments,
  hubStages,
  liveIndicator,
  startedClock,
} from './researchProgress'

const run = (status: 'QUEUED' | 'RUNNING', phase: string | null, over = {}) => ({
  status,
  phase,
  startedAt: '2026-11-10T14:41:00Z' as string | null,
  cancelRequested: false,
  ...over,
})

describe('hubStages', () => {
  it('has not started while the run is queued', () => {
    expect(hubStages(run('QUEUED', null, { startedAt: null }))).toEqual({
      started: 'active',
      analyzing: 'pending',
      finalizing: 'pending',
    })
  })

  it.each(['brand', 'voice', null])('is analyzing data in the %s phase', (phase) => {
    expect(hubStages(run('RUNNING', phase))).toEqual({
      started: 'done',
      analyzing: 'active',
      finalizing: 'pending',
    })
  })

  it.each(['findings', 'avatars'])('is finalizing results in the %s phase', (phase) => {
    expect(hubStages(run('RUNNING', phase))).toEqual({
      started: 'done',
      analyzing: 'done',
      finalizing: 'active',
    })
  })

  it('treats a phase it does not know as analyzing, never as finished', () => {
    expect(hubStages(run('RUNNING', 'something-new')).finalizing).toBe('pending')
  })
})

describe('hubSegments', () => {
  it('draws no progress before the run starts', () => {
    expect(hubSegments(hubStages(run('QUEUED', null)))).toEqual(['pending', 'pending'])
  })

  it('goes gold into the active stage and stays grey after it', () => {
    expect(hubSegments(hubStages(run('RUNNING', 'voice')))).toEqual(['active', 'pending'])
  })

  it('is emerald where a stage is done and gold into the next', () => {
    expect(hubSegments(hubStages(run('RUNNING', 'findings')))).toEqual(['done', 'active'])
  })
})

describe('liveIndicator', () => {
  it('says Live only while the run is working', () => {
    expect(liveIndicator(run('RUNNING', 'voice'))).toBe('Live')
  })

  it('says Waiting while queued', () => {
    expect(liveIndicator(run('QUEUED', null))).toBe('Waiting')
  })

  it('says Stopping once a cancel was asked for', () => {
    expect(liveIndicator(run('RUNNING', 'voice', { cancelRequested: true }))).toBe('Stopping')
  })
})

describe('startedClock', () => {
  it('is null before the run has a start time', () => {
    expect(startedClock(null)).toBeNull()
  })

  it('is null for a date it cannot read', () => {
    expect(startedClock('not a date')).toBeNull()
  })

  it('is a short local time', () => {
    expect(startedClock('2026-11-10T14:41:00Z')).toMatch(/\d{1,2}:41/)
  })
})

describe('colours', () => {
  // Text needs 4.5:1, a meaningful icon or boundary 3:1 (WCAG 1.4.3, 1.4.11).
  it.each(HUB_PAIRS)('$name holds $min:1 ($fg on $bg)', ({ fg, bg, min }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min)
  })
})
