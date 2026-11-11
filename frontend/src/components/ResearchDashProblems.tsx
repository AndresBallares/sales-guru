import { useState } from 'react'
import type { ResearchProblem, ResearchSolution } from '../lib/api'
import { filterByQuery, solutionsByProblem } from '../lib/researchDashboard'
import { Badge, Empty, Expander, SearchField, SectionHead, jumpTo } from './ResearchDashParts'
import { CircleCheckIcon, TriangleAlertIcon } from './researchHubIcons'

function ProblemCard({
  problem,
  solutions,
}: {
  problem: ResearchProblem
  solutions: ResearchSolution[]
}) {
  const [open, setOpen] = useState(false)
  const bodyId = `problem-${problem.number}-more`
  const quotes = problem.evidence.filter((e) => e.kind === 'quote').length
  return (
    <li id={`problem-${problem.number}`} tabIndex={-1} className="dash-card" data-kind="problem">
      <div className="dash-card-top">
        <span className="dash-num">
          <span className="visually-hidden">Problem </span>
          {String(problem.number).padStart(2, '0')}
        </span>
        {problem.inferred && <Badge tone="amber">Inferred</Badge>}
      </div>
      <p className={open ? undefined : 'dash-clamp'}>
        <span className="visually-hidden">Problem {problem.number}: </span>
        {problem.problem}
      </p>
      <p className="dash-small">
        {problem.evidence.length === 0
          ? 'No supporting evidence stored'
          : `${problem.evidence.length} supporting ${problem.evidence.length === 1 ? 'note' : 'notes'}${
              quotes > 0 ? `, ${quotes} ${quotes === 1 ? 'quote' : 'quotes'}` : ''
            }`}
        {solutions.length > 0 && (
          <>
            {' · '}Addressed by solution{solutions.length === 1 ? '' : 's'}{' '}
            {solutions.map((s, i) => (
              <span key={s.number}>
                {i > 0 && ', '}
                <button
                  type="button"
                  className="dash-ref"
                  aria-label={`Go to solution ${s.number}`}
                  onClick={() => jumpTo(`solution-${s.number}`)}
                >
                  {s.number}
                </button>
              </span>
            ))}
          </>
        )}
      </p>
      <Expander controls={bodyId} open={open} onToggle={() => setOpen(!open)}>
        {open ? 'Hide evidence' : 'View evidence'}
      </Expander>
      {open && (
        <div id={bodyId} className="dash-more">
          {problem.evidence.length === 0 && (
            <p className="field-hint">The research stored no quote or reasoning for this problem.</p>
          )}
          {problem.evidence.map((item, n) =>
            item.kind === 'quote' ? (
              <blockquote key={n} className="research-quote">
                “{item.text}”{' '}
                {item.status === 'verified' ? (
                  <Badge tone="green" icon={<CircleCheckIcon size={14} />}>
                    Verified
                  </Badge>
                ) : (
                  <Badge tone="grey">Unverified</Badge>
                )}{' '}
                {item.sourceUrl && (
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Source<span className="visually-hidden"> for problem {problem.number}</span>
                  </a>
                )}
              </blockquote>
            ) : (
              <p key={n} className="field-hint">
                Reasoning: {item.text}
              </p>
            ),
          )}
        </div>
      )}
    </li>
  )
}

export function ResearchDashProblems({
  problems,
  solutions,
}: {
  problems: ResearchProblem[]
  solutions: ResearchSolution[]
}) {
  const [query, setQuery] = useState('')
  const shown = filterByQuery(problems, query, (p) => p.problem)
  const bySolution = solutionsByProblem(solutions)
  return (
    <section id="research-problems" className="dash-section" aria-labelledby="research-problems-heading">
      <SectionHead
        id="research-problems-heading"
        icon={<TriangleAlertIcon size={24} />}
        title={`Problems identified (${problems.length})`}
        description="The customer pain points the research found, with the evidence behind each."
        tone="amber"
      />
      {problems.length === 0 ? (
        <Empty>No problems were stored for this run.</Empty>
      ) : (
        <>
          <SearchField
            id="problems-search"
            label="Search problems"
            value={query}
            onChange={setQuery}
            shown={shown.length}
            total={problems.length}
          />
          {shown.length === 0 ? (
            <Empty>No problems match that search.</Empty>
          ) : (
            <ol className="dash-grid" aria-label="Problems">
              {shown.map((problem) => (
                <ProblemCard
                  key={problem.number}
                  problem={problem}
                  solutions={bySolution.get(problem.number) ?? []}
                />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
