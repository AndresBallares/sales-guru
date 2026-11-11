import { useState } from 'react'
import type { ResearchSolution } from '../lib/api'
import { filterByQuery } from '../lib/researchDashboard'
import { Badge, Empty, Expander, SearchField, SectionHead, jumpTo } from './ResearchDashParts'
import { LightbulbIcon } from './researchHubIcons'

function SolutionCard({ solution }: { solution: ResearchSolution }) {
  const [open, setOpen] = useState(false)
  const bodyId = `solution-${solution.number}-more`
  const count = solution.problemNumbers.length
  return (
    <li id={`solution-${solution.number}`} tabIndex={-1} className="dash-card" data-kind="solution">
      <div className="dash-card-top">
        <span className="dash-num">
          <span className="visually-hidden">Solution </span>
          {String(solution.number).padStart(2, '0')}
        </span>
        {solution.inferred && <Badge tone="amber">Inferred</Badge>}
      </div>
      <p className={open ? undefined : 'dash-clamp'}>{solution.solution}</p>
      <p className="dash-small dash-solves">
        Solves problem{count === 1 ? '' : 's'}{' '}
        {solution.problemNumbers.map((n, i) => (
          <span key={n}>
            {i > 0 && ', '}
            <button
              type="button"
              className="dash-ref"
              aria-label={`Go to problem ${n}`}
              onClick={() => jumpTo(`problem-${n}`)}
            >
              {n}
            </button>
          </span>
        ))}
      </p>
      <Expander controls={bodyId} open={open} onToggle={() => setOpen(!open)}>
        {open ? 'Hide how it works' : 'View how it works'}
      </Expander>
      {open && (
        <div id={bodyId} className="dash-more">
          <p>{solution.mechanism || 'No further detail was stored.'}</p>
        </div>
      )}
    </li>
  )
}

export function ResearchDashSolutions({ solutions }: { solutions: ResearchSolution[] }) {
  const [query, setQuery] = useState('')
  const shown = filterByQuery(solutions, query, (s) => `${s.solution} ${s.mechanism}`)
  return (
    <section id="research-solutions" className="dash-section" aria-labelledby="research-solutions-heading">
      <SectionHead
        id="research-solutions-heading"
        icon={<LightbulbIcon size={24} />}
        title={`Proposed solutions (${solutions.length})`}
        description="Ways the product can answer those problems. Each shows the problems it says it solves."
        tone="emerald"
      />
      {solutions.length === 0 ? (
        <Empty>No solutions were stored for this run.</Empty>
      ) : (
        <>
          <SearchField
            id="solutions-search"
            label="Search solutions"
            value={query}
            onChange={setQuery}
            shown={shown.length}
            total={solutions.length}
          />
          {shown.length === 0 ? (
            <Empty>No solutions match that search.</Empty>
          ) : (
            <ol className="dash-grid" aria-label="Solutions">
              {shown.map((solution) => (
                <SolutionCard key={solution.number} solution={solution} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
