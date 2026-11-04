import type {
  ResearchAvatarDraft,
  ResearchEstimate,
  ResearchProblem,
  ResearchRun,
  ResearchSolution,
} from '../lib/api'

export function makeEstimate(overrides: Partial<ResearchEstimate> = {}): ResearchEstimate {
  return {
    depth: 'standard',
    model: 'claude-opus-5-5',
    maxSearches: 15,
    maxFetches: 20,
    expectedUsd: 1.32,
    maxUsd: 2.09,
    suggestedMaxCostUsd: 2.61,
    allowedModels: ['claude-opus-5-5'],
    runsPerMonth: 2,
    runsUsed: 1,
    runsRemaining: 1,
    readiness: [
      { field: 'key_messages', label: 'Key messages', empty: false },
      { field: 'customer_problems', label: 'Customer problems', empty: false },
      { field: 'competitors', label: 'Competitors', empty: false },
      { field: 'product_names', label: 'Product names', empty: false },
      { field: 'product_descriptions', label: 'Product descriptions', empty: false },
    ],
    ...overrides,
  }
}

export const problems: ResearchProblem[] = [
  {
    number: 1,
    problem: 'Plated jewelry fades within weeks.',
    evidence: [
      {
        kind: 'quote',
        text: 'it turned my finger green in a month',
        sourceUrl: 'https://www.reddit.com/r/jewelry/comments/1/x',
        status: 'verified',
      },
      {
        kind: 'quote',
        text: 'never again with plated',
        sourceUrl: 'https://www.trustpilot.com/review/x',
        status: 'unverified',
      },
    ],
    inferred: false,
  },
  {
    number: 2,
    problem: 'Brand names cost more than the gold.',
    evidence: [{ kind: 'inference', text: 'Likely, from category pages', sourceUrl: '' }],
    inferred: true,
  },
]

export const solutions: ResearchSolution[] = [
  { number: 1, solution: 'Solid gold', problemNumbers: [1], mechanism: 'Solid 18K', inferred: false },
  { number: 2, solution: 'Direct pricing', problemNumbers: [2], mechanism: 'Made in New York', inferred: true },
]

export function makeAvatarDraft(
  name: string,
  overrides: Partial<ResearchAvatarDraft> = {},
): ResearchAvatarDraft {
  return {
    name,
    who: `${name} buys fine jewelry.`,
    purchaseFor: 'self',
    primaryProblems: [1],
    unknownProblems: ['Coatings chip'],
    primarySolutions: [1],
    alternatives: ['Mejuri'],
    objections: ['Too soft'],
    hooks: ['The blue stays blue.'],
    creativeAngles: ['A day in the life'],
    concepts: [{ name: 'The Sanitizer Test', pillar: 'mechanism', description: 'Shows it.' }],
    inferred: false,
    ...overrides,
  }
}

export function makeRun(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: 'run-1',
    businessId: 'biz-1',
    status: 'NEEDS_REVIEW',
    phase: null,
    depth: 'standard',
    model: 'claude-opus-5-5',
    maxSearches: 15,
    maxFetches: 20,
    maxCostUsd: 3,
    searchesUsed: 12,
    fetchesUsed: 14,
    costUsd: 1.49,
    findings: {
      problems,
      solutions,
      gaps: [{ need: 'Free resizing for life', problemNumbers: [1] }],
      avatars: [
        makeAvatarDraft('The Plain-Gold Loyalist'),
        makeAvatarDraft('The Mother Passing It Forward', { hooks: ['Better than a Cartier ring'] }),
        makeAvatarDraft('The Heirloom Buyer', { inferred: true }),
      ],
      sources: [{ url: 'https://www.reddit.com/r/jewelry', title: 'Reddit thread', reached: true }],
      competitorTerms: ['Cartier', 'Spur'],
      warnings: [],
      quotes: { verified: 1, unverified: 1, dropped: 0 },
    },
    coverageNote: 'Reached 12 of 14 linked pages.',
    error: null,
    stopReason: null,
    customerVoiceSources: 8,
    customerVoiceMinimum: 6,
    evidenceLevel: 'OK',
    evidenceReason: null,
    competitorTerms: ['Cartier'],
    ignoredCompetitorTerms: ['Spur'],
    savedAvatarIds: [],
    savedDrafts: [],
    reviewedAt: null,
    cancelRequested: false,
    startedAt: '2026-11-04T10:00:00Z',
    finishedAt: '2026-11-04T10:06:00Z',
    createdAt: '2026-11-04T09:59:00Z',
    ...overrides,
  }
}
