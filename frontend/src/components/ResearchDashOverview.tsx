import type { ReactNode, RefObject } from 'react'
import type { ResearchRun } from '../lib/api'
import { depthLabel, modelLabel, statusLabel } from '../lib/research'
import {
  evidenceEntries,
  metricCounts,
  opportunitySummary,
} from '../lib/researchDashboard'
import { jumpTo } from './ResearchDashParts'
import {
  ArrowRightIcon,
  FileCheckIcon,
  LightbulbIcon,
  TargetIcon,
  TriangleAlertIcon,
  UsersIcon,
} from './researchHubIcons'

function dateLabel(run: ResearchRun): string | null {
  const stamp = run.finishedAt ?? run.createdAt
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export function ResearchDashHeader({
  run,
  savedCount,
  intro,
  headingRef,
}: {
  run: ResearchRun
  savedCount: number
  intro: ReactNode
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const stopped = run.stopReason !== null || run.findings.partial === true
  const date = dateLabel(run)
  return (
    <header className="dash-top">
      <div className="dash-top-text">
        <h2 id="research-review-heading" ref={headingRef} tabIndex={-1}>
          Market Intelligence
        </h2>
        <p className="dash-lede">
          Your research findings, customer insights, and competitive opportunities.
        </p>
        <span className="dash-rule" aria-hidden="true" />
        <p className="dash-meta">
          {date && <span>{date}</span>}
          <span>
            {depthLabel(run.depth)} research with {modelLabel(run.model)}
          </span>
        </p>
      </div>
      <p className="dash-status" data-state={stopped ? 'stopped' : 'complete'}>
        <span className="dash-status-dot" aria-hidden="true" />
        {stopped ? 'Research stopped early' : 'Research complete'}
      </p>
      <p className="field-hint dash-intro">
        {statusLabel(run.status, savedCount)}. {intro}
      </p>
    </header>
  )
}

interface Metric {
  key: 'evidence' | 'problems' | 'solutions' | 'gaps' | 'avatars'
  label: string
  sub: string
  target: string
  icon: ReactNode
  tone: 'gold' | 'amber' | 'emerald' | 'featured'
}

const METRICS: Metric[] = [
  {
    key: 'evidence',
    label: 'Evidence',
    sub: 'Supporting research findings',
    target: 'research-evidence-heading',
    icon: <FileCheckIcon size={24} />,
    tone: 'gold',
  },
  {
    key: 'problems',
    label: 'Problems identified',
    sub: 'Customer pain points discovered',
    target: 'research-problems-heading',
    icon: <TriangleAlertIcon size={24} />,
    tone: 'amber',
  },
  {
    key: 'solutions',
    label: 'Solutions identified',
    sub: 'Potential ways to address customer needs',
    target: 'research-solutions-heading',
    icon: <LightbulbIcon size={24} />,
    tone: 'emerald',
  },
  {
    key: 'gaps',
    label: 'Market opportunities',
    sub: 'Unaddressed customer needs',
    target: 'research-gaps-heading',
    icon: <TargetIcon size={24} />,
    tone: 'gold',
  },
  {
    key: 'avatars',
    label: 'AI Customer Avatars',
    sub: 'Profiles built from this research',
    target: 'research-drafts-heading',
    icon: <UsersIcon size={24} />,
    tone: 'featured',
  },
]

// Five counts, each worked out from the records the run stored. The avatar count is the number
// the avatar section lists, passed in so the two cannot differ.
export function ResearchMetricCards({ run, avatarCount }: { run: ResearchRun; avatarCount: number }) {
  const counts = metricCounts(run.findings, avatarCount)
  return (
    <ul className="dash-metrics" aria-label="Research summary">
      {METRICS.map((metric) => (
        <li key={metric.key}>
          <button
            type="button"
            className="dash-metric"
            data-tone={metric.tone}
            aria-label={`${counts[metric.key]} ${metric.label}. Go to this section.`}
            onClick={() => jumpTo(metric.target)}
          >
            <span
              className="dash-ico"
              data-tone={metric.tone === 'featured' ? 'emerald' : metric.tone}
              aria-hidden="true"
            >
              {metric.icon}
            </span>
            <span className="dash-metric-value" aria-hidden="true">
              {counts[metric.key]}
            </span>
            <span className="dash-metric-label" aria-hidden="true">
              {metric.label}
            </span>
            <span className="dash-metric-sub" aria-hidden="true">
              {metric.sub}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// The market gaps up front: what the research found nobody addressing, with the problems and
// the sources behind each. Only what the run stored is shown.
export function MarketOpportunityPanel({ run }: { run: ResearchRun }) {
  const gaps = run.findings.gaps ?? []
  const evidence = evidenceEntries(run.findings.problems ?? [])
  const preview = gaps.slice(0, 3)
  return (
    <section className="dash-opportunity" aria-labelledby="research-opportunity-heading">
      <div className="dash-opportunity-head">
        <span className="dash-ico dash-ico-lg" data-tone="gold" aria-hidden="true">
          <TargetIcon size={28} />
        </span>
        <div>
          <h3 id="research-opportunity-heading">Market Opportunities</h3>
          <p className="dash-sub">
            Discover the customer needs that existing competitors are not fully addressing.
          </p>
        </div>
      </div>
      <p className="dash-summary">{opportunitySummary(gaps)}</p>
      {preview.length > 0 && (
        <ul className="dash-opportunity-list" aria-label="Top opportunities">
          {preview.map((gap, index) => {
            const hosts = [
              ...new Set(
                evidence
                  .filter((e) => gap.problemNumbers.includes(e.problemNumber) && e.host)
                  .map((e) => e.host as string),
              ),
            ].slice(0, 3)
            return (
              <li key={gap.need}>
                <span className="dash-opportunity-n" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <p>{gap.need}</p>
                  <p className="dash-small">
                    Related problems: {gap.problemNumbers.join(', ') || 'none listed'}
                    {hosts.length > 0 && <> · Sources: {hosts.join(', ')}</>}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {gaps.length > 0 && (
        <button
          type="button"
          className="dash-link-button"
          onClick={() => jumpTo('research-gaps-heading')}
        >
          Explore all opportunities
          <ArrowRightIcon />
        </button>
      )}
    </section>
  )
}
