import { describe, expect, it } from 'vitest'
import type { ResearchFindings } from './api'
import type { ReviewDraft } from './research'
import {
  avatarSummary,
  evidenceEntries,
  filterByQuery,
  hostOf,
  initialsOf,
  metricCounts,
  opportunitySummary,
  previewOf,
  solutionsByProblem,
} from './researchDashboard'

const findings: ResearchFindings = {
  problems: [
    {
      number: 1,
      problem: 'Colour chips when stored next to other jewellery.',
      inferred: false,
      evidence: [
        { kind: 'quote', text: 'avoid chips or scratches', sourceUrl: 'https://www.foundrae.com/care', status: 'verified' },
        { kind: 'quote', text: 'unchecked line', sourceUrl: '', status: 'unverified' },
      ],
    },
    {
      number: 4,
      problem: 'Repairs are expensive.',
      inferred: true,
      evidence: [{ kind: 'inference', text: 'Care page implies it.', sourceUrl: '' }],
    },
    { number: 7, problem: 'Unknown brand feels risky.', inferred: true, evidence: [] },
  ],
  solutions: [
    { number: 1, solution: 'Ceramic inlay', problemNumbers: [1, 4], mechanism: 'Scratch resistant', inferred: false },
    { number: 2, solution: 'GIA report', problemNumbers: [7], mechanism: 'Published on page', inferred: false },
    { number: 3, solution: 'Free repairs', problemNumbers: [4, 7], mechanism: 'Lifetime care', inferred: true },
  ],
  gaps: [
    { need: 'A repair policy.', problemNumbers: [4, 1] },
    { need: 'Customer reviews.', problemNumbers: [7, 4] },
  ],
}

describe('evidenceEntries', () => {
  it('lists every quote and every piece of reasoning with the problem it belongs to', () => {
    const entries = evidenceEntries(findings.problems ?? [])
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ problemNumber: 1, kind: 'quote', status: 'verified', host: 'foundrae.com' })
    expect(entries[1]).toMatchObject({ kind: 'quote', status: 'unverified', host: null })
    expect(entries[2]).toMatchObject({ problemNumber: 4, kind: 'inference' })
    expect(new Set(entries.map((e) => e.id)).size).toBe(3)
  })

  it('is empty when there are no problems', () => {
    expect(evidenceEntries([])).toEqual([])
  })
})

describe('metricCounts', () => {
  it('counts the real records and never assumes 20', () => {
    expect(metricCounts(findings, 5)).toEqual({ evidence: 3, problems: 3, solutions: 3, gaps: 2, avatars: 5 })
  })

  it('is all zeros for a run that stored nothing', () => {
    expect(metricCounts({}, 0)).toEqual({ evidence: 0, problems: 0, solutions: 0, gaps: 0, avatars: 0 })
  })
})

describe('solutionsByProblem', () => {
  it('uses the stored links, not matching numbers', () => {
    const map = solutionsByProblem(findings.solutions ?? [])
    expect(map.get(1)?.map((s) => s.number)).toEqual([1])
    expect(map.get(4)?.map((s) => s.number)).toEqual([1, 3])
    expect(map.get(7)?.map((s) => s.number)).toEqual([2, 3])
    expect(map.get(2)).toBeUndefined()
  })
})

describe('opportunitySummary', () => {
  it('states only what the gaps hold', () => {
    expect(opportunitySummary(findings.gaps ?? [])).toBe(
      '2 customer needs that the research found nobody addressing, tied to 3 of the problems above.',
    )
  })

  it('uses the singular for one gap', () => {
    expect(opportunitySummary([{ need: 'x', problemNumbers: [1] }])).toBe(
      '1 customer need that the research found nobody addressing, tied to 1 of the problems above.',
    )
  })

  it('says so when there are none', () => {
    expect(opportunitySummary([])).toBe('No unaddressed needs were found in this research.')
  })
})

describe('filterByQuery', () => {
  const items = ['Chips and scratches', 'Expensive repairs', 'Brand risk']
  it('matches any part, ignoring case', () => {
    expect(filterByQuery(items, 'REPAIR', (s) => s)).toEqual(['Expensive repairs'])
  })
  it('returns everything for an empty or blank query', () => {
    expect(filterByQuery(items, '', (s) => s)).toHaveLength(3)
    expect(filterByQuery(items, '   ', (s) => s)).toHaveLength(3)
  })
  it('returns nothing when nothing matches', () => {
    expect(filterByQuery(items, 'zzz', (s) => s)).toEqual([])
  })
})

describe('previewOf', () => {
  it('keeps short text whole', () => {
    expect(previewOf('Short text.', 50)).toEqual({ text: 'Short text.', cut: false })
  })
  it('cuts long text at a word and marks it', () => {
    const out = previewOf('one two three four five six', 14)
    expect(out.cut).toBe(true)
    expect(out.text).toBe('one two three…')
  })
})

describe('hostOf', () => {
  it('returns the host without www', () => {
    expect(hostOf('https://www.example.com/a/b?c=1')).toBe('example.com')
  })
  it('returns null for an empty or broken url', () => {
    expect(hostOf('')).toBeNull()
    expect(hostOf('not a url')).toBeNull()
  })
})

describe('initialsOf', () => {
  it('skips a leading "The" and takes two letters', () => {
    expect(initialsOf('The Chipped-Color Veteran')).toBe('CV')
    expect(initialsOf('The Heritage Emerald Buyer')).toBe('HE')
  })
  it('handles one word and empty names', () => {
    expect(initialsOf('Loyalist')).toBe('L')
    expect(initialsOf('  ')).toBe('?')
  })
})

function draft(over: Partial<ReviewDraft> = {}, lists: Partial<ReviewDraft['lists']> = {}): ReviewDraft {
  return {
    keep: false,
    name: 'The Chipped-Color Veteran',
    who: 'Buys fine jewelry for daily wear.',
    purchaseFor: 'self',
    lists: {
      primaryProblems: 'Color chips\nRepairs cost a lot',
      unknownProblems: '',
      mechanisms: 'Ceramic inlay\nSolid gold',
      alternatives: '',
      objections: 'Is it really chip proof?\nPrice',
      hooks: '',
      creativeAngles: '',
      ...lists,
    },
    concepts: [
      { name: 'a', pillar: 'offer', description: 'x' },
      { name: 'b', pillar: 'emotion', description: 'y' },
    ],
    inferred: false,
    ...over,
  }
}

describe('avatarSummary', () => {
  it('takes the first problem, objection and mechanism, and counts concepts', () => {
    expect(avatarSummary(draft())).toEqual({
      buyer: 'Self-purchaser',
      problem: 'Color chips',
      objection: 'Is it really chip proof?',
      win: 'Ceramic inlay',
      concepts: 2,
    })
  })

  it('names a gift buyer', () => {
    expect(avatarSummary(draft({ purchaseFor: 'gift' })).buyer).toBe('Gift-buyer')
  })

  it('leaves out what the avatar does not have, and invents nothing', () => {
    const out = avatarSummary(draft({ concepts: [] }, { primaryProblems: '', objections: '  ', mechanisms: '' }))
    expect(out).toEqual({ buyer: 'Self-purchaser', problem: null, objection: null, win: null, concepts: 0 })
  })
})
