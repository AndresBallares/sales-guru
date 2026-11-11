import type {
  ResearchFindings,
  ResearchGap,
  ResearchProblem,
  ResearchSolution,
} from './api'

// Pure helpers for the research results dashboard. Everything here reads what the run
// stored; nothing is made up (no scores, titles, categories or links the data lacks).

export interface EvidenceEntry {
  // Unique and stable for one run: the problem number and the position within it.
  id: string
  problemNumber: number
  problemText: string
  kind: 'quote' | 'inference'
  text: string
  sourceUrl: string
  // Only quotes carry a check result; a reasoning note is never "verified".
  status: 'verified' | 'unverified' | null
  host: string | null
}

export function hostOf(url: string): string | null {
  if (url.trim() === '') return null
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export function evidenceEntries(problems: ResearchProblem[]): EvidenceEntry[] {
  return problems.flatMap((problem) =>
    problem.evidence.map((item, n) => ({
      id: `p${problem.number}-e${n}`,
      problemNumber: problem.number,
      problemText: problem.problem,
      kind: item.kind,
      text: item.text,
      sourceUrl: item.sourceUrl,
      status: item.kind === 'quote' ? (item.status ?? 'unverified') : null,
      host: hostOf(item.sourceUrl),
    })),
  )
}

export function metricCounts(findings: ResearchFindings) {
  return {
    evidence: evidenceEntries(findings.problems ?? []).length,
    problems: (findings.problems ?? []).length,
    solutions: (findings.solutions ?? []).length,
    gaps: (findings.gaps ?? []).length,
  }
}

// Problem number -> the solutions that say they solve it, in solution order.
export function solutionsByProblem(solutions: ResearchSolution[]): Map<number, ResearchSolution[]> {
  const map = new Map<number, ResearchSolution[]>()
  for (const solution of solutions) {
    for (const number of solution.problemNumbers) {
      map.set(number, [...(map.get(number) ?? []), solution])
    }
  }
  return map
}

export function opportunitySummary(gaps: ResearchGap[]): string {
  if (gaps.length === 0) return 'No unaddressed needs were found in this research.'
  const linked = new Set(gaps.flatMap((g) => g.problemNumbers)).size
  const needs = gaps.length === 1 ? '1 customer need' : `${gaps.length} customer needs`
  return `${needs} that the research found nobody addressing, tied to ${linked} of the problems above.`
}

export function filterByQuery<T>(items: T[], query: string, textOf: (item: T) => string): T[] {
  const q = query.trim().toLowerCase()
  if (q === '') return items
  return items.filter((item) => textOf(item).toLowerCase().includes(q))
}

// A cut at a word boundary for a collapsed card. The full text is always one click away.
export function previewOf(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false }
  const slice = text.slice(0, max)
  const space = slice.lastIndexOf(' ')
  return { text: `${(space > 0 ? slice.slice(0, space) : slice).trimEnd()}…`, cut: true }
}

// Two letters for a placeholder portrait; avatars have no image of their own.
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const meaningful = words[0]?.toLowerCase() === 'the' && words.length > 1 ? words.slice(1) : words
  const letters = meaningful.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '')
  return letters.join('') || '?'
}
