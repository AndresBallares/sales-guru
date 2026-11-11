import { useState } from 'react'
import type { ResearchRun } from '../lib/api'
import { evidenceEntries, filterByQuery, type EvidenceEntry } from '../lib/researchDashboard'
import { Badge, Empty, Expander, SearchField, SectionHead } from './ResearchDashParts'
import { CircleCheckIcon, FileCheckIcon, GlobeIcon, LinkIcon } from './researchHubIcons'

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

function EvidenceCard({ entry, number }: { entry: EvidenceEntry; number: number }) {
  const [open, setOpen] = useState(false)
  const bodyId = `evidence-${entry.id}`
  const quote = entry.kind === 'quote'
  return (
    <li className="dash-card" data-kind={entry.kind}>
      <div className="dash-card-top">
        <span className="dash-num">Evidence {number}</span>
        {quote ? (
          entry.status === 'verified' ? (
            <Badge tone="green" icon={<CircleCheckIcon size={14} />}>
              Verified
            </Badge>
          ) : (
            <Badge tone="grey">Unverified</Badge>
          )
        ) : (
          <Badge tone="gold">Reasoning</Badge>
        )}
      </div>
      <p className="dash-clamp">{quote ? `“${entry.text}”` : entry.text}</p>
      <p className="dash-small dash-source">
        {entry.host ? (
          <>
            <GlobeIcon size={16} />
            {entry.host}
          </>
        ) : (
          'No source page'
        )}
        <span>· Problem {entry.problemNumber}</span>
      </p>
      <Expander controls={bodyId} open={open} onToggle={() => setOpen(!open)}>
        View supporting evidence
      </Expander>
      {open && (
        <div id={bodyId} className="dash-more">
          <p>{quote ? `“${entry.text}”` : entry.text}</p>
          <p className="dash-small">
            Supports problem {entry.problemNumber}: {entry.problemText}
          </p>
          {entry.sourceUrl && (
            <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="dash-source-link">
              <LinkIcon size={16} />
              Open source<span className="visually-hidden"> for problem {entry.problemNumber}</span>
            </a>
          )}
        </div>
      )}
    </li>
  )
}

// What the run found and how well it is backed: the run-level notes first (coverage, warnings,
// quote checks), then one card per quote or reasoning note.
export function ResearchDashEvidence({ run }: { run: ResearchRun }) {
  const [query, setQuery] = useState('')
  const findings = run.findings
  const entries = evidenceEntries(findings.problems ?? [])
  const shown = filterByQuery(entries, query, (e) => `${e.text} ${e.host ?? ''} ${e.problemText}`)
  const quotes = findings.quotes
  const low = run.evidenceLevel === 'LOW'
  const sources = findings.sources ?? []

  return (
    <section
      id="research-evidence"
      className="dash-section research-evidence"
      aria-labelledby="research-evidence-heading"
    >
      <SectionHead
        id="research-evidence-heading"
        icon={<FileCheckIcon size={24} />}
        title="Evidence"
        description="Research findings and supporting information collected from your website and competitors."
      />
      <div className="dash-notes">
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
            Quotes: {quotes.verified} verified, {quotes.unverified} unverified (the page could not
            be checked), {quotes.dropped} removed (not found on the page).
          </p>
        )}
        {run.stopReason && (
          <p className="field-hint">
            This run stopped before it finished ({run.stopReason}). What it found so far is below.
          </p>
        )}
        {(findings.warnings ?? []).length > 0 && (
          <ul aria-label="Warnings">
            {(findings.warnings ?? []).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {run.coverageNote && (
          <details className="dash-coverage">
            <summary>Coverage</summary>
            <p>{run.coverageNote}</p>
          </details>
        )}
        {sources.length > 0 && (
          <details className="dash-coverage">
            <summary>
              Sources ({sources.length})
            </summary>
            <ul aria-label="Research sources">
              {sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title || source.url}
                  </a>{' '}
                  <span className="dash-small">{source.reached ? 'reached' : 'not reached'}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {entries.length === 0 ? (
        <Empty>No evidence was stored for this run.</Empty>
      ) : (
        <>
          <SearchField
            id="evidence-search"
            label="Search evidence"
            value={query}
            onChange={setQuery}
            shown={shown.length}
            total={entries.length}
          />
          {shown.length === 0 ? (
            <Empty>No evidence matches that search.</Empty>
          ) : (
            <ol className="dash-grid" aria-label="Evidence">
              {shown.map((entry) => (
                <EvidenceCard key={entry.id} entry={entry} number={entries.indexOf(entry) + 1} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
