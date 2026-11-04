import type {
  ConceptPillar,
  PurchaseFor,
  ResearchAvatarDraft,
  ResearchDepth,
  ResearchModel,
  ResearchProblem,
  ResearchSolution,
  ResearchStatus,
} from './api'
import { AVATAR_LIST_FIELDS, type AvatarListField } from './avatarFields'

export const MAX_RESEARCH_PRODUCTS = 3
export const MAX_RESEARCH_COMPETITOR_URLS = 5

export const RESEARCH_DEPTHS: { value: ResearchDepth; label: string; meaning: string }[] = [
  {
    value: 'light',
    label: 'Light',
    meaning: 'A quick pass: a handful of searches. Cheapest, but the thinnest on customer voice.',
  },
  {
    value: 'standard',
    label: 'Standard',
    meaning: 'The usual choice: enough searches to reach forums, reviews and competitor sites.',
  },
  {
    value: 'deep',
    label: 'Deep',
    meaning: 'The most sources. Takes longest and costs the most; use it for a new market.',
  },
]

export const RESEARCH_MODELS: {
  value: ResearchModel
  label: string
  note: string
  // Shown instead of the note while the business may not use the model.
  unavailableNote: string
}[] = [
  {
    value: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    note: 'The standard research model.',
    unavailableNote: 'Not turned on for this business.',
  },
  {
    value: 'claude-fable-5-1',
    label: 'Claude Fable 5.1 (premium)',
    note: 'A premium model that costs about twice as much.',
    unavailableNote:
      'Premium, about twice the cost. Not turned on for this business: ask us to enable it.',
  },
]

export function modelLabel(model: string): string {
  return RESEARCH_MODELS.find((m) => m.value === model)?.label ?? model
}

export function depthLabel(depth: string): string {
  return RESEARCH_DEPTHS.find((d) => d.value === depth)?.label ?? depth
}

export function phaseLabel(status: ResearchStatus, phase: string | null): string {
  if (status === 'QUEUED') return 'Waiting to start'
  switch (phase) {
    case 'brand':
      return 'Reading your site and your competitors'
    case 'voice':
      return 'Looking for what customers say'
    case 'findings':
      return 'Writing up problems and solutions'
    case 'avatars':
      return 'Drafting avatars'
    default:
      return 'Working'
  }
}

const STATUS_LABELS: Record<ResearchStatus, string> = {
  QUEUED: 'Waiting to start',
  RUNNING: 'Running',
  NEEDS_REVIEW: 'Ready to review',
  REVIEWED: 'Done',
  DISCARDED: 'Discarded',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
}

// `savedCount` is how many avatars were saved from the run so far: a run still open for
// review but already saved from reads "In review" rather than "Ready to review".
export function statusLabel(status: ResearchStatus, savedCount = 0): string {
  if (status === 'NEEDS_REVIEW' && savedCount > 0) return 'In review'
  return STATUS_LABELS[status]
}

export function elapsedLabel(startedAt: string | null, finishedAt: string | null, now: number) {
  if (!startedAt) return '0s'
  const end = finishedAt ? Date.parse(finishedAt) : now
  const seconds = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export type ReadinessPlace = 'brand' | 'products'

const ADVICE: Record<string, { why: string; where: ReadinessPlace }> = {
  key_messages: {
    where: 'brand',
    why: 'The research tests your promises against what customers say. Without them it has to guess what you stand for.',
  },
  customer_problems: {
    where: 'brand',
    why: 'These tell the research which problems to look for first. Without them it starts from the category in general.',
  },
  competitors: {
    where: 'brand',
    why: 'The research reads competitor sites and keeps their brand names out of your ads. With none, it looks only for generic rivals.',
  },
  product_names: {
    where: 'products',
    why: 'The name is how the research recognizes your product in reviews and forums.',
  },
  product_descriptions: {
    where: 'products',
    why: 'The description is what the research checks customer talk against. Without it the avatars are less specific.',
  },
}

export function readinessAdvice(field: string): { why: string; where: ReadinessPlace } {
  return (
    ADVICE[field] ?? {
      where: 'brand',
      why: 'The research uses this to tailor what it looks for.',
    }
  )
}

// Same folding as the backend's research_text.normalize, so the review screen flags the
// same copy the run would have: curly quotes and dashes straightened, spaces collapsed.
const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '−': '-',
}

function fold(text: string): string {
  return text
    .replace(/[‘’‚‛“”„–—−]/g, (c) => FOLD[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Which terms appear in the text as whole words or phrases (the backend's terms_in).
export function termsIn(text: string, terms: string[]): string[] {
  const haystack = fold(text)
  return terms.filter((term) => {
    const wanted = fold(term)
    if (wanted === '') return false
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(wanted)}(?![\\p{L}\\p{N}_])`, 'u').test(
      haystack,
    )
  })
}

export interface ConceptRow {
  name: string
  pillar: ConceptPillar
  description: string
}

// One avatar while it is reviewed. Lists are one entry per line of text.
export interface ReviewDraft {
  keep: boolean
  name: string
  who: string
  purchaseFor: PurchaseFor
  lists: Record<AvatarListField, string>
  concepts: ConceptRow[]
  inferred: boolean
}

// A research avatar points at problems and solutions by number; the library stores
// text. Problems become their text; mechanisms come from the numbered primary solutions
// (each once). Both stay editable.
export function avatarDraftFrom(
  avatar: ResearchAvatarDraft,
  problems: ResearchProblem[],
  solutions: ResearchSolution[],
): ReviewDraft {
  const problemText = (n: number) => problems.find((p) => p.number === n)?.problem
  const mechanisms: string[] = []
  for (const n of avatar.primarySolutions ?? []) {
    const mechanism = solutions.find((s) => s.number === n)?.mechanism
    if (mechanism && !mechanisms.includes(mechanism)) mechanisms.push(mechanism)
  }
  const values: Record<AvatarListField, string[]> = {
    primaryProblems: (avatar.primaryProblems ?? []).flatMap((n) => problemText(n) ?? []),
    unknownProblems: avatar.unknownProblems ?? [],
    mechanisms,
    alternatives: avatar.alternatives ?? [],
    objections: avatar.objections ?? [],
    hooks: avatar.hooks ?? [],
    creativeAngles: avatar.creativeAngles ?? [],
  }
  const lists = {} as Record<AvatarListField, string>
  for (const { key } of AVATAR_LIST_FIELDS) lists[key] = values[key].join('\n')
  return {
    keep: false,
    name: avatar.name,
    who: avatar.who,
    purchaseFor: avatar.purchaseFor,
    lists,
    concepts: (avatar.concepts ?? []).map((c) => ({
      name: c.name,
      pillar: c.pillar,
      description: c.description,
    })),
    inferred: avatar.inferred,
  }
}

// Where a saved avatar sits in the library: the Avatars tab with that avatar picked out.
// Used as the link's address; clicking it is handled in the page, without a reload.
export function avatarHref(avatarId: string): string {
  const { pathname, hash } = window.location
  return `${pathname}?avatar=${encodeURIComponent(avatarId)}${hash}`
}
