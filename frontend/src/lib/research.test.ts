import { describe, expect, it } from 'vitest'
import {
  avatarDraftFrom,
  elapsedLabel,
  formatUsd,
  phaseLabel,
  readinessAdvice,
  statusLabel,
  termsIn,
} from './research'
import type { ResearchAvatarDraft, ResearchProblem, ResearchSolution } from './api'

describe('termsIn', () => {
  it('finds whole words and phrases, ignoring case and curly quotes', () => {
    expect(termsIn('Our Bulgari-style ring', ['bulgari'])).toEqual(['bulgari'])
    expect(termsIn("it’s a steal", ["it's a steal"])).toEqual(["it's a steal"])
    expect(termsIn('Harwell   Godfrey vibes', ['Harwell Godfrey'])).toEqual(['Harwell Godfrey'])
  })
  it('does not match inside a longer word', () => {
    expect(termsIn('a cartiering of words', ['cartier'])).toEqual([])
    expect(termsIn('Spurious claims', ['Spur'])).toEqual([])
  })
  it('treats regex characters in a term literally and skips blank terms', () => {
    expect(termsIn('Wear B.Zero1 daily', ['B.Zero1'])).toEqual(['B.Zero1'])
    expect(termsIn('abc', ['a.c', '  ', ''])).toEqual([])
  })
})

describe('labels', () => {
  it('names each phase in plain words', () => {
    expect(phaseLabel('QUEUED', null)).toBe('Waiting to start')
    expect(phaseLabel('RUNNING', 'brand')).toBe('Reading your site and your competitors')
    expect(phaseLabel('RUNNING', 'voice')).toBe('Looking for what customers say')
    expect(phaseLabel('RUNNING', 'findings')).toBe('Writing up problems and solutions')
    expect(phaseLabel('RUNNING', 'avatars')).toBe('Drafting avatars')
    expect(phaseLabel('RUNNING', null)).toBe('Working')
    expect(phaseLabel('RUNNING', 'surprise')).toBe('Working')
  })
  it('names each status', () => {
    expect(statusLabel('NEEDS_REVIEW')).toBe('Ready to review')
    expect(statusLabel('REVIEWED')).toBe('Done')
    expect(statusLabel('NEEDS_REVIEW', 2)).toBe('In review')
    expect(statusLabel('NEEDS_REVIEW', 0)).toBe('Ready to review')
    expect(statusLabel('DISCARDED')).toBe('Discarded')
    expect(statusLabel('FAILED')).toBe('Failed')
    expect(statusLabel('CANCELED')).toBe('Canceled')
    expect(statusLabel('RUNNING')).toBe('Running')
    expect(statusLabel('QUEUED')).toBe('Waiting to start')
  })
  it('formats elapsed time and money', () => {
    const start = '2026-11-04T10:00:00Z'
    expect(elapsedLabel(start, null, Date.parse('2026-11-04T10:00:07Z'))).toBe('7s')
    expect(elapsedLabel(start, null, Date.parse('2026-11-04T10:03:12Z'))).toBe('3m 12s')
    expect(elapsedLabel(start, '2026-11-04T10:06:00Z', Date.parse('2026-11-04T12:00:00Z'))).toBe(
      '6m 0s',
    )
    expect(elapsedLabel(null, null, 0)).toBe('0s')
    expect(formatUsd(1.4935)).toBe('$1.49')
    expect(formatUsd(0)).toBe('$0.00')
  })
})

describe('readinessAdvice', () => {
  it('says why each empty item matters and where to fill it in', () => {
    const keyMessages = readinessAdvice('key_messages')
    expect(keyMessages.where).toBe('brand')
    expect(keyMessages.why.length).toBeGreaterThan(10)
    expect(readinessAdvice('product_names').where).toBe('products')
    expect(readinessAdvice('product_descriptions').where).toBe('products')
    expect(readinessAdvice('competitors').where).toBe('brand')
    expect(readinessAdvice('customer_problems').where).toBe('brand')
  })
  it('falls back for an item it does not know', () => {
    expect(readinessAdvice('something_new').where).toBe('brand')
  })
})

const problems: ResearchProblem[] = [
  { number: 1, problem: 'Plated fades', evidence: [], inferred: false },
  { number: 2, problem: 'Logo tax', evidence: [], inferred: false },
  { number: 3, problem: 'Fear of scams', evidence: [], inferred: true },
]
const solutions: ResearchSolution[] = [
  { number: 1, solution: 'Solid gold', problemNumbers: [1], mechanism: 'Solid 18K', inferred: false },
  { number: 2, solution: 'GIA report', problemNumbers: [3], mechanism: 'GIA report', inferred: false },
  { number: 3, solution: 'Ceramic', problemNumbers: [1], mechanism: 'Solid 18K', inferred: false },
]
const avatar: ResearchAvatarDraft = {
  name: 'The Loyalist',
  who: 'Wears plain gold.',
  purchaseFor: 'gift',
  primaryProblems: [2, 1, 99],
  unknownProblems: ['Coatings chip'],
  primarySolutions: [1, 2, 3],
  alternatives: ['Mejuri'],
  objections: ['Too soft'],
  hooks: ['Hook one'],
  creativeAngles: ['Angle one'],
  concepts: [{ name: 'Sanitizer Test', pillar: 'mechanism', description: 'Shows it' }],
  inferred: true,
}

describe('avatarDraftFrom', () => {
  it('turns numbered problems and solutions into library text', () => {
    const draft = avatarDraftFrom(avatar, problems, solutions)
    expect(draft.name).toBe('The Loyalist')
    expect(draft.purchaseFor).toBe('gift')
    expect(draft.lists.primaryProblems).toBe('Logo tax\nPlated fades')
    expect(draft.lists.mechanisms).toBe('Solid 18K\nGIA report')
    expect(draft.lists.hooks).toBe('Hook one')
    expect(draft.lists.creativeAngles).toBe('Angle one')
    expect(draft.concepts).toEqual([
      { name: 'Sanitizer Test', pillar: 'mechanism', description: 'Shows it' },
    ])
    expect(draft.inferred).toBe(true)
    expect(draft.keep).toBe(false)
  })
  it('copes with missing lists', () => {
    const bare = { ...avatar, primaryProblems: [], primarySolutions: [], concepts: [] }
    const draft = avatarDraftFrom(bare, [], [])
    expect(draft.lists.primaryProblems).toBe('')
    expect(draft.lists.mechanisms).toBe('')
    expect(draft.concepts).toEqual([])
  })
})
