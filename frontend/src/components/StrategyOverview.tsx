import { useId, useState } from 'react'
import type { StrategyContent } from '../lib/api'
import { buildStrategyView } from '../lib/strategyView'
import { ArrowRightIcon, ChevronDownIcon, SpinnerIcon } from './icons'

interface Props {
  strategy: StrategyContent
  campaignName: string
  // Undefined hides the Generate Ads call to action (e.g. a published campaign's ads are locked).
  onGenerateAds?: () => void
  generating?: boolean
  error?: string
}

export function StrategyOverview({
  strategy,
  campaignName,
  onGenerateAds,
  generating = false,
  error,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const view = buildStrategyView(strategy)

  return (
    <div className="strategy-overview" aria-label={`Strategy for ${campaignName}`}>
      <section className="strategy-panel" aria-labelledby={`${detailsId}-glance`}>
        <h4 id={`${detailsId}-glance`}>Strategy at a glance</h4>
        <p className="strategy-subtitle">Your campaign strategy, summarized.</p>
        {view.summary && <p className="strategy-summary">{view.summary}</p>}
        {view.glance.length > 0 && (
          <dl className="strategy-glance">
            {view.glance.map((item) => (
              <div key={item.label} className="strategy-glance-item">
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {view.sections.length > 0 && (
          <>
            <button
              type="button"
              className="strategy-toggle"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? 'Hide full strategy' : 'View full strategy'}
              <span className="strategy-toggle-chevron" aria-hidden="true">
                <ChevronDownIcon />
              </span>
            </button>
            <div id={detailsId} className="strategy-full" hidden={!expanded}>
              {expanded &&
                view.sections.map((section) => (
                  <section key={section.id} className="strategy-section">
                    <h5>{section.title}</h5>
                    <dl>
                      {section.fields.map((field) => (
                        <div key={field.label} className="strategy-field">
                          <dt>{field.label}</dt>
                          <dd>
                            {field.text && <p>{field.text}</p>}
                            {field.items && (
                              <ul>
                                {field.items.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
            </div>
          </>
        )}
      </section>

      <section className="strategy-angles" aria-labelledby={`${detailsId}-angles`}>
        <h4 id={`${detailsId}-angles`}>Creative angles to test</h4>
        <p className="strategy-subtitle">
          Explore the messages Sales Guru will use to develop your ad variations.
        </p>
        {view.angles.length > 0 ? (
          <ul className="strategy-angle-grid">
            {view.angles.map((angle, index) => (
              <li key={`${angle.title}-${index}`} className="strategy-angle-card">
                {angle.tag && <span className="strategy-angle-tag">{angle.tag}</span>}
                <h5>{angle.title}</h5>
                {angle.description && <p>{angle.description}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="strategy-angle-empty">
            Creative directions will be developed during ad generation, based on this strategy.
          </p>
        )}
      </section>

      {onGenerateAds && (
        <section className="strategy-cta" aria-labelledby={`${detailsId}-cta`}>
          <h4 id={`${detailsId}-cta`}>Ready to create your ads?</h4>
          <p>Generate ad variations based on your campaign strategy and product assets.</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn-generate"
            onClick={onGenerateAds}
            disabled={generating}
            aria-busy={generating}
          >
            {generating ? (
              <>
                <SpinnerIcon />
                Generating ads…
              </>
            ) : (
              <>
                {error ? 'Try again' : 'Generate Ads'}
                <ArrowRightIcon />
              </>
            )}
          </button>
        </section>
      )}
    </div>
  )
}
