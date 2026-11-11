import type { BuyerAvatar, ConceptPillar } from '../lib/api'
import { AVATAR_LIST_FIELDS, CONCEPT_PILLARS, MAX_BUYER_AVATARS, MAX_CONCEPTS } from '../lib/avatarFields'
import { avatarHref, termsIn, type ReviewDraft } from '../lib/research'
import { initialsOf } from '../lib/researchDashboard'
import { Badge, SectionHead } from './ResearchDashParts'
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

// Avatars have no picture of their own, so each card shows a placeholder with the initials.
function Portrait({ name, state }: { name: string; state: 'saved' | 'selected' | 'open' }) {
  return (
    <div className="dash-portrait" data-state={state} aria-hidden="true">
      <span>{initialsOf(name)}</span>
    </div>
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
  const libraryNames = new Set(library.map((a) => a.name.trim().toLowerCase()))
  const nameCounts = new Map<string, number>()
  for (const d of drafts) {
    const key = d.name.trim().toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }

  return (
    <section
      id="research-avatars"
      className="dash-section research-drafts"
      aria-labelledby="research-drafts-heading"
    >
      <SectionHead
        id="research-drafts-heading"
        icon={<UsersIcon size={24} />}
        title="AI Customer Avatars"
        description="Select the customer profiles that best represent your target audience."
        tone="emerald"
      />
      <p className="dash-slots">
        {library.length} of {MAX_BUYER_AVATARS} avatar slots used; {slotsLeft} left.{' '}
        <span>{selectedCount} selected</span>
      </p>
      {savedCount > 0 && <p className="field-hint">{savedCount} saved from this research.</p>}
      {drafts.length === 0 && <p className="dash-empty">The run produced no avatar drafts.</p>}
      <ul aria-label="Avatar drafts" className="dash-avatars">
        {drafts.map((draft, index) => {
          const original = initialDrafts[index]
          const base = `research-draft-${index}`
          const name = draft.name.trim().toLowerCase()
          const savedAs = savedBy.get(index)
          if (savedAs !== undefined) {
            const inLibrary = library.find((a) => a.id === savedAs)
            const shownName = inLibrary?.name ?? original.name
            return (
              <li key={index} className="dash-avatar" data-state="saved" aria-label={original.name}>
                <Portrait name={original.name} state="saved" />
                <div className="dash-avatar-body">
                  <div className="dash-avatar-badges">
                    <Badge tone="green" icon={<BookmarkCheckIcon size={14} />}>
                      Saved
                    </Badge>
                  </div>
                  <h4>{original.name}</h4>
                  <p className="dash-clamp">{original.who}</p>
                  <a
                    href={avatarHref(savedAs)}
                    onClick={(event) => {
                      event.preventDefault()
                      onOpenAvatar(savedAs)
                    }}
                  >
                    View {shownName} in your library
                  </a>
                </div>
              </li>
            )
          }
          const flagged = flaggedTerms(draft, terms)
          return (
            <li
              key={index}
              className="dash-avatar"
              data-state={draft.keep ? 'selected' : 'open'}
              aria-label={original.name}
            >
              <Portrait name={draft.name} state={draft.keep ? 'selected' : 'open'} />
              <div className="dash-avatar-body">
                <div className="dash-avatar-badges">
                  {draft.keep ? (
                    <Badge tone="green" icon={<CircleCheckIcon size={14} />}>
                      Selected
                    </Badge>
                  ) : (
                    <Badge tone="grey">Not saved</Badge>
                  )}
                  {draft.inferred && <Badge tone="amber">Inferred</Badge>}
                </div>
                <h4>{draft.name}</h4>
                <p className="dash-clamp">{draft.who}</p>
                <p className="dash-small">
                  Buys for: {draft.purchaseFor === 'gift' ? 'a gift' : 'themselves'}
                </p>
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
              </div>
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
    </section>
  )
}
