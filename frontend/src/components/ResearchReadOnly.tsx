import type { BuyerAvatar, ResearchRun } from '../lib/api'
import { avatarHref } from '../lib/research'
import { ResearchFindingsView } from './ResearchFindingsView'

// The research of a run that is closed (done, or discarded), to read and not to change: what
// it found, the competitor terms, and every avatar draft, marked Saved (with a link to the
// library) or Not saved. Reopening a done run brings back the editable review.
export function ResearchReadOnly({
  run,
  library,
  onOpenAvatar,
}: {
  run: ResearchRun
  library: BuyerAvatar[]
  onOpenAvatar: (avatarId: string) => void
}) {
  const drafts = run.findings.avatars ?? []
  const savedBy = new Map<number, string>(run.savedDrafts.map((d) => [d.draftIndex, d.avatarId]))

  return (
    <section className="research-review" aria-labelledby="research-readonly-heading">
      <h3 id="research-readonly-heading">What the research found</h3>
      <ResearchFindingsView run={run} />

      {run.competitorTerms.length > 0 && (
        <section className="research-terms" aria-labelledby="research-terms-readonly-heading">
          <h3 id="research-terms-readonly-heading">Competitor terms</h3>
          <ul aria-label="Competitor terms" className="research-terms-list">
            {run.competitorTerms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="research-drafts" aria-labelledby="research-drafts-readonly-heading">
        <h3 id="research-drafts-readonly-heading">Avatar drafts</h3>
        {drafts.length === 0 && <p>The run produced no avatar drafts.</p>}
        <ul aria-label="Avatar drafts" className="avatar-list">
          {drafts.map((draft, index) => {
            const savedAs = savedBy.get(index)
            const inLibrary = savedAs === undefined ? undefined : library.find((a) => a.id === savedAs)
            return (
              <li key={index} className="avatar-item" aria-label={draft.name}>
                <div className="avatar-item-head">
                  <h4>{draft.name}</h4>
                  {draft.inferred && <span className="avatar-badge">Inferred</span>}
                  {savedAs === undefined ? (
                    <span className="avatar-badge avatar-badge-off">Not saved</span>
                  ) : (
                    <>
                      <span className="avatar-badge">Saved</span>{' '}
                      <a
                        href={avatarHref(savedAs)}
                        onClick={(event) => {
                          event.preventDefault()
                          onOpenAvatar(savedAs)
                        }}
                      >
                        View {inLibrary?.name ?? draft.name} in your library
                      </a>
                    </>
                  )}
                </div>
                <p>{draft.who}</p>
                <p className="field-hint">
                  Buys {draft.purchaseFor === 'gift' ? 'as a gift' : 'for themselves'}.
                </p>
                {draft.hooks.length > 0 && (
                  <>
                    <h5>Hooks</h5>
                    <ul aria-label={`Hooks for ${draft.name}`}>
                      {draft.hooks.map((hook) => (
                        <li key={hook}>{hook}</li>
                      ))}
                    </ul>
                  </>
                )}
                {draft.concepts.length > 0 && (
                  <>
                    <h5>Concepts</h5>
                    <ul aria-label={`Concepts for ${draft.name}`}>
                      {draft.concepts.map((concept) => (
                        <li key={concept.name}>
                          <strong>{concept.name}</strong> ({concept.pillar}): {concept.description}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </section>
  )
}
