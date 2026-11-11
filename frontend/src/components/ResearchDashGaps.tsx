import type { ResearchGap, ResearchProblem } from '../lib/api'
import { evidenceEntries } from '../lib/researchDashboard'
import { Empty, SectionHead, jumpTo } from './ResearchDashParts'
import { TargetIcon } from './researchHubIcons'

// "Gaps nobody solves yet": the needs the research found no competitor meeting. A gap holds
// only its need and the problems it ties to; there is no score, so none is shown.
export function ResearchDashGaps({
  gaps,
  problems,
}: {
  gaps: ResearchGap[]
  problems: ResearchProblem[]
}) {
  const evidence = evidenceEntries(problems)
  return (
    <section id="research-gaps" className="dash-section dash-gaps" aria-labelledby="research-gaps-heading">
      <SectionHead
        id="research-gaps-heading"
        icon={<TargetIcon size={24} />}
        title="Gaps Nobody Solves Yet"
        description="Customer needs the research found that no competitor is meeting."
      />
      {gaps.length === 0 ? (
        <Empty>No gaps were found in this research.</Empty>
      ) : (
        <ul aria-label="Gaps" className="dash-grid">
          {gaps.map((gap, index) => {
            const hosts = [
              ...new Set(
                evidence
                  .filter((e) => gap.problemNumbers.includes(e.problemNumber) && e.host)
                  .map((e) => e.host as string),
              ),
            ]
            return (
              <li key={gap.need} className="dash-card dash-gap-card" data-kind="gap">
                <div className="dash-card-top">
                  <span className="dash-num">
                    <span className="visually-hidden">Opportunity </span>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="dash-ico" data-tone="gold" aria-hidden="true">
                    <TargetIcon size={18} />
                  </span>
                </div>
                <p>{gap.need}</p>
                <p className="dash-small">
                  Related problems:{' '}
                  {gap.problemNumbers.length === 0
                    ? 'none listed'
                    : gap.problemNumbers.map((n, i) => (
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
                {hosts.length > 0 && (
                  <p className="dash-small">Evidence sources: {hosts.slice(0, 4).join(', ')}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
