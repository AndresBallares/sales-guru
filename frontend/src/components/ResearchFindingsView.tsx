import type { ResearchFindings, ResearchRun } from '../lib/api'

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

// What a run found, to read: its evidence, the problems with their quotes, the solutions and
// the gaps. Shared by the editable review and the read-only view of a closed run.
export function ResearchFindingsView({ run }: { run: ResearchRun }) {
  const findings: ResearchFindings = run.findings
  const problems = findings.problems ?? []
  const solutions = findings.solutions ?? []
  const low = run.evidenceLevel === 'LOW'
  const quotes = findings.quotes

  return (
    <>
      <section className="research-evidence" aria-labelledby="research-evidence-heading">
        <h3 id="research-evidence-heading">Evidence</h3>
        <p>
          {run.customerVoiceSources} customer-voice{' '}
          {plural(run.customerVoiceSources, 'source', 'sources')} reached (minimum for a {run.depth}{' '}
          run: {run.customerVoiceMinimum}).
        </p>
        {low && (
          <p className="research-warning">
            <strong>Low evidence</strong>{' '}
            {run.evidenceReason ??
              'Few customer-voice sources were reached. Treat the problems as mostly inferred.'}
          </p>
        )}
        {quotes && (
          <p className="field-hint">
            Quotes: {quotes.verified} verified, {quotes.unverified} unverified (the page could
            not be checked), {quotes.dropped} removed (not found on the page).
          </p>
        )}
        {run.stopReason && (
          <p className="field-hint">
            This run stopped before it finished ({run.stopReason}). What it found so far is
            below.
          </p>
        )}
        {run.coverageNote && (
          <>
            <h4>Coverage</h4>
            <p>{run.coverageNote}</p>
          </>
        )}
        {(findings.warnings ?? []).length > 0 && (
          <ul aria-label="Warnings">
            {(findings.warnings ?? []).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      <details open className="research-block">
        <summary>
          <h3>Problems ({problems.length})</h3>
        </summary>
        <ol aria-label="Problems" className="research-list">
          {problems.map((problem) => (
            <li key={problem.number}>
              <p>
                <span className="visually-hidden">Problem {problem.number}: </span>
                {problem.problem}{' '}
                {problem.inferred && <span className="avatar-badge">Inferred</span>}
              </p>
              {problem.evidence.map((item, n) =>
                item.kind === 'quote' ? (
                  <blockquote key={n} className="research-quote">
                    “{item.text}”{' '}
                    <span
                      className={
                        item.status === 'verified'
                          ? 'avatar-badge'
                          : 'avatar-badge avatar-badge-off'
                      }
                    >
                      {item.status === 'verified' ? 'Verified' : 'Unverified'}
                    </span>{' '}
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
            </li>
          ))}
        </ol>
      </details>

      <details open className="research-block">
        <summary>
          <h3>Solutions ({solutions.length})</h3>
        </summary>
        <ol aria-label="Solutions" className="research-list">
          {solutions.map((solution) => (
            <li key={solution.number}>
              <p>
                {solution.solution}{' '}
                {solution.inferred && <span className="avatar-badge">Inferred</span>}
              </p>
              <p className="field-hint">
                Solves {plural(solution.problemNumbers.length, 'problem', 'problems')}{' '}
                {solution.problemNumbers.join(', ')}. {solution.mechanism}
              </p>
            </li>
          ))}
        </ol>
        {(findings.gaps ?? []).length > 0 && (
          <>
            <h4>Gaps nobody solves yet</h4>
            <ul aria-label="Gaps">
              {(findings.gaps ?? []).map((gap) => (
                <li key={gap.need}>
                  {gap.need}{' '}
                  <span className="field-hint">
                    (problems {gap.problemNumbers.join(', ')})
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </>
  )
}
