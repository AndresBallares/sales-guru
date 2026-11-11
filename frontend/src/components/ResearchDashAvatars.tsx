import type { BuyerAvatar, ConceptPillar } from '../lib/api'
import { AVATAR_LIST_FIELDS, CONCEPT_PILLARS, MAX_BUYER_AVATARS, MAX_CONCEPTS } from '../lib/avatarFields'
import { avatarHref, termsIn, type ReviewDraft } from '../lib/research'
import { avatarSummary, initialsOf, type AvatarSummary } from '../lib/researchDashboard'
import { Badge, SectionHead } from './ResearchDashParts'
import { useState } from 'react'
import { BookmarkCheckIcon, ChevronDownIcon, CircleCheckIcon, UsersIcon } from './researchHubIcons'

// The copy a competitor term must stay out of: hooks, angles and concepts.
function flaggedTerms(draft: ReviewDraft, terms: string[]): string[] {
  const text = [
    draft.lists.hooks,
    draft.lists.creativeAngles,
    ...draft.concepts.map((c) => `${c.name} ${c.description}`),
  ].join('\n')
  return termsIn(text, terms)
}

// How many avatars the featured section shows before "View all".
export const FEATURED_AVATARS = 6

// Avatars have no picture of their own, so each card carries a small mark with the initials.
function Mark({ name }: { name: string }) {
  return (
    <span className="dash-avatar-mark" aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

// The facts a card leads with. A line with nothing behind it is left out, not filled.
function Facts({ summary }: { summary: AvatarSummary }) {
  return (
    <>
      {summary.win && (
        <div className="dash-win">
          <span className="dash-label">What wins them</span>
          <p>{summary.win}</p>
        </div>
      )}
      {(summary.problem || summary.objection) && (
        <dl className="dash-facts">
          {summary.problem && (
            <div>
              <dt>Primary problem</dt>
              <dd className="dash-clamp-2">{summary.problem}</dd>
            </div>
          )}
          {summary.objection && (
            <div>
              <dt>Buying objection</dt>
              <dd className="dash-clamp-2">{summary.objection}</dd>
            </div>
          )}
        </dl>
      )}
      {summary.concepts > 0 && (
        <p className="dash-concepts">
          {summary.concepts} Creative {plural(summary.concepts, 'Concept', 'Concepts')}
        </p>
      )}
    </>
  )
}

export function ResearchDashAvatars({
  drafts,
  initialDrafts,
  savedBy,
  library,
  terms,
  savedCount,
  selectedCount,
  slotsLeft,
  onChange,
  onOpenAvatar,
}: {
  drafts: ReviewDraft[]
  initialDrafts: ReviewDraft[]
  savedBy: Map<number, string>
  library: BuyerAvatar[]
  terms: string[]
  savedCount: number
  selectedCount: number
  slotsLeft: number
  onChange: (index: number, patch: Partial<ReviewDraft>) => void
  onOpenAvatar: (avatarId: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const libraryNames = new Set(library.map((a) => a.name.trim().toLowerCase()))
  const nameCounts = new Map<string, number>()
  for (const d of drafts) {
    const key = d.name.trim().toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  const hidden = drafts.length - FEATURED_AVATARS

  return (
    <section
      id="research-avatars"
      className="dash-section dash-featured research-drafts"
      aria-labelledby="research-drafts-heading"
    >
      <SectionHead
        id="research-drafts-heading"
        icon={<UsersIcon size={24} />}
        title="AI Customer Avatars"
        description="Meet the customers your advertising should speak to. These AI-generated profiles are built from your market research, customer problems, purchasing motivations, and competitive insights."
        tone="emerald"
      />
      <p className="dash-count-line">
        {drafts.length} customer {plural(drafts.length, 'avatar', 'avatars')}
      </p>
      <p className="dash-slots">
        {library.length} of {MAX_BUYER_AVATARS} avatar slots used; {slotsLeft} left.{' '}
        <span>{selectedCount} selected</span>
      </p>
      {savedCount > 0 && <p className="field-hint">{savedCount} saved from this research.</p>}
      {drafts.length === 0 && <p className="dash-empty">The run produced no avatar drafts.</p>}
      <ul aria-label="Avatar drafts" className="dash-avatars">
        {drafts.map((draft, index) => {
          if (!showAll && index >= FEATURED_AVATARS) return null
          const original = initialDrafts[index]
          const base = `research-draft-${index}`
          const name = draft.name.trim().toLowerCase()
          const savedAs = savedBy.get(index)
          if (savedAs !== undefined) {
            const inLibrary = library.find((a) => a.id === savedAs)
            const shownName = inLibrary?.name ?? original.name
            const summary = avatarSummary(original)
            // The library's own concept count when it has one: that is what the Strategist uses.
            if (inLibrary?.concepts) summary.concepts = inLibrary.concepts.length
            return (
              <li key={index} className="dash-avatar" data-state="saved" aria-label={original.name}>
                <div className="dash-avatar-head">
                  <Mark name={original.name} />
                  <div className="dash-avatar-id">
                    <h4>{original.name}</h4>
                    <div className="dash-avatar-badges">
                      <Badge tone="gold">{summary.buyer}</Badge>
                      <Badge tone="green" icon={<BookmarkCheckIcon size={14} />}>
                        Saved
                      </Badge>
                    </div>
                  </div>
                </div>
                <p className="dash-clamp dash-who">{original.who}</p>
                <Facts summary={summary} />
                <a
                  className="dash-library-link"
                  href={avatarHref(savedAs)}
                  onClick={(event) => {
                    event.preventDefault()
                    onOpenAvatar(savedAs)
                  }}
                >
                  View {shownName} in your library
                </a>
              </li>
            )
          }
          const flagged = flaggedTerms(draft, terms)
          const summary = avatarSummary(draft)
          return (
            <li
              key={index}
              className="dash-avatar"
              data-state={draft.keep ? 'selected' : 'open'}
              aria-label={original.name}
            >
              <div className="dash-avatar-head">
                <Mark name={draft.name} />
                <div className="dash-avatar-id">
                  <h4>{draft.name}</h4>
                  <div className="dash-avatar-badges">
                    <Badge tone="gold">{summary.buyer}</Badge>
                    {draft.inferred && <Badge tone="amber">Inferred</Badge>}
                  </div>
                </div>
                {draft.keep ? (
                  <Badge tone="green" icon={<CircleCheckIcon size={14} />}>
                    Selected
                  </Badge>
                ) : (
                  <Badge tone="grey">Not saved</Badge>
                )}
              </div>
              <p className="dash-clamp dash-who">{draft.who}</p>
              <Facts summary={summary} />
              {libraryNames.has(name) && (
                <p className="form-error">
                  An avatar with this name is already in your library. Rename it or leave it out.
                </p>
              )}
              {(nameCounts.get(name) ?? 0) > 1 && (
                <p className="form-error">This has the same name as another draft here.</p>
              )}
              {flagged.length > 0 && (
                <p className="research-warning">Contains a competitor term: {flagged.join(', ')}</p>
              )}
              <label className="dash-pick" htmlFor={`${base}-keep`}>
                <input
                  type="checkbox"
                  id={`${base}-keep`}
                  checked={draft.keep}
                  onChange={(event) => onChange(index, { keep: event.target.checked })}
                />
                <span aria-hidden="true">{draft.keep ? 'Selected' : 'Select to save'}</span>
                <span className="visually-hidden">Save {draft.name}</span>
              </label>
              <details className="dash-persona">
                <summary>
                  View persona details
                  <span className="dash-chevron" aria-hidden="true">
                    <ChevronDownIcon size={16} />
                  </span>
                </summary>
                <div className="field">
                  <label htmlFor={`${base}-name`}>Name</label>
                  <input
                    id={`${base}-name`}
                    maxLength={60}
                    value={draft.name}
                    onChange={(event) => onChange(index, { name: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${base}-who`}>Who they are</label>
                  <textarea
                    id={`${base}-who`}
                    rows={3}
                    maxLength={600}
                    value={draft.who}
                    onChange={(event) => onChange(index, { who: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${base}-for`}>Who they buy for</label>
                  <select
                    id={`${base}-for`}
                    value={draft.purchaseFor}
                    onChange={(event) =>
                      onChange(index, { purchaseFor: event.target.value as 'self' | 'gift' })
                    }
                  >
                    <option value="self">Themselves</option>
                    <option value="gift">A gift</option>
                  </select>
                </div>
                {AVATAR_LIST_FIELDS.map(({ key, label }) => (
                  <div className="field" key={key}>
                    <label htmlFor={`${base}-${key}`}>{label}</label>
                    <textarea
                      id={`${base}-${key}`}
                      rows={3}
                      value={draft.lists[key]}
                      onChange={(event) =>
                        onChange(index, { lists: { ...draft.lists, [key]: event.target.value } })
                      }
                    />
                    <span className="field-hint">One per line.</span>
                  </div>
                ))}
                <fieldset className="research-group">
                  <legend>Concepts</legend>
                  {draft.concepts.map((concept, n) => {
                    const patchConcept = (patch: Partial<typeof concept>) =>
                      onChange(index, {
                        concepts: draft.concepts.map((c, i) => (i === n ? { ...c, ...patch } : c)),
                      })
                    return (
                      <div key={n} className="research-concept">
                        <div className="field">
                          <label htmlFor={`${base}-c${n}-name`}>Concept {n + 1} name</label>
                          <input
                            id={`${base}-c${n}-name`}
                            maxLength={60}
                            value={concept.name}
                            onChange={(event) => patchConcept({ name: event.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`${base}-c${n}-pillar`}>Concept {n + 1} pillar</label>
                          <select
                            id={`${base}-c${n}-pillar`}
                            value={concept.pillar}
                            onChange={(event) =>
                              patchConcept({ pillar: event.target.value as ConceptPillar })
                            }
                          >
                            {CONCEPT_PILLARS.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`${base}-c${n}-desc`}>Concept {n + 1} description</label>
                          <textarea
                            id={`${base}-c${n}-desc`}
                            rows={2}
                            maxLength={200}
                            value={concept.description}
                            onChange={(event) => patchConcept({ description: event.target.value })}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-outline"
                          onClick={() =>
                            onChange(index, { concepts: draft.concepts.filter((_, i) => i !== n) })
                          }
                        >
                          Remove concept {n + 1}
                        </button>
                      </div>
                    )
                  })}
                  {draft.concepts.length < MAX_CONCEPTS && (
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() =>
                        onChange(index, {
                          concepts: [...draft.concepts, { name: '', pillar: 'offer', description: '' }],
                        })
                      }
                    >
                      Add a concept
                    </button>
                  )}
                </fieldset>
              </details>
            </li>
          )
        })}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className="dash-btn dash-btn-ghost dash-view-all"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show fewer avatars' : `View all ${drafts.length} avatars`}
        </button>
      )}
    </section>
  )
}
