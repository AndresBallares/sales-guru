import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ResearchFindings, ResearchRun } from '../lib/api'
import { ResearchDashCompetitors } from './ResearchDashCompetitors'
import { ResearchDashEvidence } from './ResearchDashEvidence'
import { ResearchDashGaps } from './ResearchDashGaps'
import { MarketOpportunityPanel, ResearchDashHeader, ResearchMetricCards } from './ResearchDashOverview'
import { ResearchDashProblems } from './ResearchDashProblems'
import { ResearchDashSolutions } from './ResearchDashSolutions'

const findings: ResearchFindings = {
  problems: [
    {
      number: 1,
      problem: 'Colour chips when stored next to other jewellery.',
      inferred: false,
      evidence: [
        { kind: 'quote', text: 'avoid chips or scratches', sourceUrl: 'https://www.foundrae.com/care', status: 'verified' },
        { kind: 'quote', text: 'a line we could not check', sourceUrl: '', status: 'unverified' },
      ],
    },
    {
      number: 4,
      problem: 'Repairs are expensive and unpredictable.',
      inferred: true,
      evidence: [{ kind: 'inference', text: 'The care page implies it.', sourceUrl: '' }],
    },
    { number: 7, problem: 'A brand you never heard of feels risky.', inferred: true, evidence: [] },
  ],
  solutions: [
    { number: 1, solution: 'Ceramic inlay that resists scratches', problemNumbers: [1, 4], mechanism: 'Scratch resistant ceramic', inferred: false },
    { number: 2, solution: 'GIA report on the page', problemNumbers: [7], mechanism: '', inferred: true },
  ],
  gaps: [
    { need: 'A published repair policy.', problemNumbers: [4, 1] },
    { need: 'Customer reviews on product pages.', problemNumbers: [7] },
  ],
  sources: [{ url: 'https://foundrae.com/care', title: 'Foundrae care page', reached: true }],
  quotes: { verified: 1, unverified: 1, dropped: 0 },
}

function makeRun(overrides: Partial<ResearchRun> = {}): ResearchRun {
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
    costUsd: 1.25,
    findings,
    coverageNote: 'Reached 12 of 14 pages.',
    error: null,
    stopReason: null,
    customerVoiceSources: 9,
    customerVoiceMinimum: 6,
    evidenceLevel: 'OK',
    evidenceReason: null,
    competitorTerms: [],
    ignoredCompetitorTerms: [],
    savedAvatarIds: [],
    savedDrafts: [],
    reviewedAt: null,
    cancelRequested: false,
    startedAt: '2026-11-10T10:00:00Z',
    finishedAt: '2026-11-10T10:30:00Z',
    createdAt: '2026-11-10T09:59:00Z',
    ...overrides,
  }
}

describe('metric cards and the opportunity panel', () => {
  it('count the stored records, and a card jumps to its section', async () => {
    const user = userEvent.setup()
    const target = document.createElement('h3')
    target.id = 'research-solutions-heading'
    target.tabIndex = -1
    document.body.append(target)
    render(<ResearchMetricCards run={makeRun()} />)
    expect(screen.getByRole('button', { name: /^3 Evidence/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^3 Problems identified/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^2 Solutions identified/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^2 Market opportunities/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Solutions identified/ }))
    expect(target).toHaveFocus()
    target.remove()
  })

  it('shows the gaps with their problems and sources, and only what the run holds', () => {
    render(<MarketOpportunityPanel run={makeRun()} />)
    expect(screen.getByText(/2 customer needs that the research found nobody addressing/)).toBeInTheDocument()
    expect(screen.getByText('A published repair policy.')).toBeInTheDocument()
    expect(screen.getByText(/Related problems: 4, 1 · Sources: foundrae.com/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Explore all opportunities/ })).toBeInTheDocument()
  })

  it('says so, and offers nothing to explore, when there are no gaps', () => {
    render(<MarketOpportunityPanel run={makeRun({ findings: { ...findings, gaps: [] } })} />)
    expect(screen.getByText('No unaddressed needs were found in this research.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Explore all opportunities/ })).not.toBeInTheDocument()
  })

  it('shows zero counts for a run that stored nothing', () => {
    render(<ResearchMetricCards run={makeRun({ findings: {} })} />)
    expect(screen.getAllByRole('button', { name: /^0 / })).toHaveLength(4)
  })
})

describe('header', () => {
  const ref = { current: null }
  it('reads complete for a finished run', () => {
    render(<ResearchDashHeader run={makeRun()} savedCount={0} intro="Pick some." headingRef={ref} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Market Intelligence' })).toBeInTheDocument()
    expect(screen.getByText('Research complete')).toBeInTheDocument()
  })
  it('reads stopped early when the run did not finish', () => {
    render(<ResearchDashHeader run={makeRun({ stopReason: 'cap' })} savedCount={0} intro="x" headingRef={ref} />)
    expect(screen.getByText('Research stopped early')).toBeInTheDocument()
  })
})

describe('evidence', () => {
  it('shows verified only for a checked quote, and opens the source on request', async () => {
    const user = userEvent.setup()
    render(<ResearchDashEvidence run={makeRun()} />)
    const cards = within(screen.getByRole('list', { name: 'Evidence' })).getAllByRole('listitem')
    expect(cards).toHaveLength(3)
    expect(within(cards[0]).getByText('Verified')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Unverified')).toBeInTheDocument()
    expect(within(cards[1]).queryByText('Verified')).not.toBeInTheDocument()
    expect(within(cards[2]).getByText('Reasoning')).toBeInTheDocument()
    await user.click(within(cards[0]).getByRole('button', { name: /View supporting evidence/ }))
    const link = within(cards[0]).getByRole('link', { name: /Open source/ })
    expect(link).toHaveAttribute('href', 'https://www.foundrae.com/care')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('searches, counts the matches and reports none', async () => {
    const user = userEvent.setup()
    render(<ResearchDashEvidence run={makeRun()} />)
    await user.type(screen.getByRole('searchbox', { name: 'Search evidence' }), 'scratches')
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 3')
    await user.clear(screen.getByRole('searchbox', { name: 'Search evidence' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search evidence' }), 'zzz')
    expect(screen.getByText('No evidence matches that search.')).toBeInTheDocument()
  })

  it('keeps the run notes, the coverage and the sources', () => {
    render(<ResearchDashEvidence run={makeRun({ evidenceLevel: 'LOW', stopReason: 'cap' })} />)
    expect(screen.getByText('Low evidence')).toBeInTheDocument()
    expect(screen.getByText(/stopped before it finished \(cap\)/)).toBeInTheDocument()
    expect(screen.getByText('Coverage')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Foundrae care page' })).toHaveAttribute('href', 'https://foundrae.com/care')
  })

  it('says when nothing was stored', () => {
    render(<ResearchDashEvidence run={makeRun({ findings: {}, coverageNote: null })} />)
    expect(screen.getByText('No evidence was stored for this run.')).toBeInTheDocument()
  })
})

describe('problems and solutions', () => {
  it('links each problem to the solutions that name it, not to a matching number', () => {
    render(<ResearchDashProblems problems={findings.problems ?? []} solutions={findings.solutions ?? []} />)
    const items = within(screen.getByRole('list', { name: 'Problems' })).getAllByRole('listitem')
    // Problem 4 is solved by solution 1 (its stored link), and nothing names problem 4 as solution 4.
    expect(within(items[1]).getByRole('button', { name: 'Go to solution 1' })).toBeInTheDocument()
    expect(within(items[1]).queryByRole('button', { name: 'Go to solution 4' })).not.toBeInTheDocument()
    expect(within(items[2]).getByRole('button', { name: 'Go to solution 2' })).toBeInTheDocument()
  })

  it('opens a problem to its quotes and reasoning, and says when it has none', async () => {
    const user = userEvent.setup()
    render(<ResearchDashProblems problems={findings.problems ?? []} solutions={[]} />)
    const items = within(screen.getByRole('list', { name: 'Problems' })).getAllByRole('listitem')
    await user.click(within(items[1]).getByRole('button', { name: /View evidence/ }))
    expect(within(items[1]).getByText(/The care page implies it/)).toBeInTheDocument()
    await user.click(within(items[2]).getByRole('button', { name: /View evidence/ }))
    expect(within(items[2]).getByText(/stored no quote or reasoning/)).toBeInTheDocument()
  })

  it('searches problems and reports no match', async () => {
    const user = userEvent.setup()
    render(<ResearchDashProblems problems={findings.problems ?? []} solutions={[]} />)
    await user.type(screen.getByRole('searchbox', { name: 'Search problems' }), 'repairs')
    expect(within(screen.getByRole('list', { name: 'Problems' })).getAllByRole('listitem')).toHaveLength(1)
    await user.clear(screen.getByRole('searchbox', { name: 'Search problems' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search problems' }), 'qqq')
    expect(screen.getByText('No problems match that search.')).toBeInTheDocument()
  })

  it('shows solutions with the problems they solve and opens the mechanism', async () => {
    const user = userEvent.setup()
    render(<ResearchDashSolutions solutions={findings.solutions ?? []} />)
    const items = within(screen.getByRole('list', { name: 'Solutions' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Solves problems 1, 4')
    expect(items[1]).toHaveTextContent('Solves problem 7')
    await user.click(within(items[0]).getByRole('button', { name: /View how it works/ }))
    expect(within(items[0]).getByText('Scratch resistant ceramic')).toBeInTheDocument()
    await user.click(within(items[1]).getByRole('button', { name: /View how it works/ }))
    expect(within(items[1]).getByText('No further detail was stored.')).toBeInTheDocument()
  })

  it('searches solutions and shows empty states', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ResearchDashSolutions solutions={findings.solutions ?? []} />)
    await user.type(screen.getByRole('searchbox', { name: 'Search solutions' }), 'nope')
    expect(screen.getByText('No solutions match that search.')).toBeInTheDocument()
    rerender(<ResearchDashSolutions solutions={[]} />)
    expect(screen.getByText('No solutions were stored for this run.')).toBeInTheDocument()
    rerender(<ResearchDashProblems problems={[]} solutions={[]} />)
    expect(screen.getByText('No problems were stored for this run.')).toBeInTheDocument()
  })
})

describe('gaps', () => {
  it('lists each gap with its related problems and the sources behind them', () => {
    render(<ResearchDashGaps gaps={findings.gaps ?? []} problems={findings.problems ?? []} />)
    const gaps = within(screen.getByRole('list', { name: 'Gaps' })).getAllByRole('listitem')
    expect(gaps).toHaveLength(2)
    expect(within(gaps[0]).getByText('A published repair policy.')).toBeInTheDocument()
    expect(within(gaps[0]).getByText(/Evidence sources: foundrae.com/)).toBeInTheDocument()
    expect(within(gaps[0]).getByRole('button', { name: 'Go to problem 4' })).toBeInTheDocument()
    // No score or ranking is invented.
    expect(gaps[0]).not.toHaveTextContent(/score|priority|rank/i)
  })

  it('says when there are none', () => {
    render(<ResearchDashGaps gaps={[]} problems={[]} />)
    expect(screen.getByText('No gaps were found in this research.')).toBeInTheDocument()
  })
})

describe('competitors', () => {
  it('adds, removes and filters chips', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onRemove = vi.fn()
    const terms = Array.from({ length: 10 }, (_, i) => `Brand ${i}`)
    render(<ResearchDashCompetitors terms={terms} ignored={['Spur']} onRemove={onRemove} onAdd={onAdd} />)
    expect(screen.getByText(/Ignored as common words: Spur/)).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search competitors' }), 'brand 3')
    expect(within(screen.getByRole('list', { name: 'Competitor terms' })).getAllByRole('listitem')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Remove term Brand 3' }))
    expect(onRemove).toHaveBeenCalledWith('Brand 3')
    await user.type(screen.getByLabelText('Add a competitor term'), 'Zorblax{Enter}')
    expect(onAdd).toHaveBeenCalledWith('Zorblax')
    await user.type(screen.getByLabelText('Add a competitor term'), 'Other')
    await user.click(screen.getByRole('button', { name: 'Add term' }))
    expect(onAdd).toHaveBeenLastCalledWith('Other')
    await user.clear(screen.getByRole('searchbox', { name: 'Search competitors' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search competitors' }), 'nothing')
    expect(screen.getByText('No competitor matches that search.')).toBeInTheDocument()
  })

  it('invites a first term when there are none', () => {
    render(<ResearchDashCompetitors terms={[]} ignored={[]} onRemove={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByText(/No competitor terms yet/)).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})
