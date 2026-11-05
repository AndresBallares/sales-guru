import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  bulkCreateAvatars,
  discardResearchRun,
  markResearchRunDone,
  type BuyerAvatar,
  type BuyerAvatarDraft,
  type ConceptPillar,
  type ResearchRun,
} from '../lib/api'
import {
  AVATAR_LIST_FIELDS,
  CONCEPT_PILLARS,
  MAX_BUYER_AVATARS,
  MAX_CONCEPTS,
  linesOf,
} from '../lib/avatarFields'
import {
  avatarDraftFrom,
  avatarHref,
  statusLabel,
  termsIn,
  type ReviewDraft,
} from '../lib/research'
import { ResearchFindingsView } from './ResearchFindingsView'
import { UNSAVED_MESSAGE, useUnsavedWarning } from '../lib/useUnsavedWarning'

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

function toApiDraft(draft: ReviewDraft): BuyerAvatarDraft {
  return {
    name: draft.name.trim(),
    who: draft.who.trim(),
    purchaseFor: draft.purchaseFor,
    primaryProblems: linesOf(draft.lists.primaryProblems),
    unknownProblems: linesOf(draft.lists.unknownProblems),
    mechanisms: linesOf(draft.lists.mechanisms),
    alternatives: linesOf(draft.lists.alternatives),
    objections: linesOf(draft.lists.objections),
    hooks: linesOf(draft.lists.hooks),
    creativeAngles: linesOf(draft.lists.creativeAngles),
    // A row left without a name or description is not a concept; leave it out.
    concepts: draft.concepts
      .filter((c) => c.name.trim() !== '' && c.description.trim() !== '')
      .map((c) => ({ name: c.name.trim(), pillar: c.pillar, description: c.description.trim() })),
  }
}

// The copy a competitor term must stay out of: hooks, angles and concepts.
function flaggedTerms(draft: ReviewDraft, terms: string[]): string[] {
  const text = [
    draft.lists.hooks,
    draft.lists.creativeAngles,
    ...draft.concepts.map((c) => `${c.name} ${c.description}`),
  ].join('\n')
  return termsIn(text, terms)
}

// The review screen for a run in NEEDS_REVIEW: read what the research found, pick and edit
// avatars, check the competitor terms, then save the picks to the library (or discard).
export function ResearchReview({
  businessId,
  run,
  library,
  onSaved,
  onDiscarded,
  onDone,
  onOpenAvatar,
  onBack,
}: {
  businessId: string
  run: ResearchRun
  // The business's avatars now, for the duplicate-name warning and the slots left.
  library: BuyerAvatar[]
  onSaved: (created: BuyerAvatar[]) => void
  onDiscarded: () => void
  // The review was finished with Mark as done.
  onDone: () => void
  // Opens the library with this avatar picked out.
  onOpenAvatar: (avatarId: string) => void
  onBack: () => void
}) {
  const findings = run.findings
  const problems = useMemo(() => findings.problems ?? [], [findings.problems])
  const solutions = useMemo(() => findings.solutions ?? [], [findings.solutions])
  const initialDrafts = useMemo(
    () => (findings.avatars ?? []).map((a) => avatarDraftFrom(a, problems, solutions)),
    [findings.avatars, problems, solutions],
  )
  const [drafts, setDrafts] = useState<ReviewDraft[]>(initialDrafts)
  const [terms, setTerms] = useState<string[]>(run.competitorTerms)
  const [newTerm, setNewTerm] = useState('')
  const [saving, setSaving] = useState(false)
  // Drafts saved in this visit, until the run itself reports them (draft index -> avatar id).
  const [justSaved, setJustSaved] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [confirmingDone, setConfirmingDone] = useState(false)
  // Set at once on a click, before React re-renders, so a double click sends one request.
  const busyRef = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  // Which drafts are already in the library, and the avatar each became.
  const savedBy = new Map<number, string>(run.savedDrafts.map((d) => [d.draftIndex, d.avatarId]))
  for (const [index, avatarId] of Object.entries(justSaved)) savedBy.set(Number(index), avatarId)
  const savedCount = Math.max(savedBy.size, run.savedAvatarIds.length)

  // Only drafts still to save can hold unsaved edits; a saved one is what the library has.
  const dirty =
    drafts.some((d, i) => !savedBy.has(i) && JSON.stringify(d) !== JSON.stringify(initialDrafts[i])) ||
    JSON.stringify(terms) !== JSON.stringify(run.competitorTerms)
  useUnsavedWarning(dirty)

  const libraryNames = new Set(library.map((a) => a.name.trim().toLowerCase()))
  const nameCounts = new Map<string, number>()
  for (const d of drafts) {
    const key = d.name.trim().toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  const slotsLeft = Math.max(MAX_BUYER_AVATARS - library.length, 0)
  const selectedIndexes = drafts.flatMap((d, i) => (d.keep && !savedBy.has(i) ? [i] : []))
  const selected = selectedIndexes.map((i) => drafts[i])
  const tooMany = selected.length > slotsLeft
  const canSave = selected.length > 0 && !tooMany && !saving

  function update(index: number, patch: Partial<ReviewDraft>) {
    setDrafts((current) => current.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  function leave(go: () => void) {
    if (!dirty || window.confirm(UNSAVED_MESSAGE)) go()
  }

  function addTerm() {
    const term = newTerm.trim()
    setNewTerm('')
    if (term === '' || terms.some((t) => t.toLowerCase() === term.toLowerCase())) return
    setTerms([...terms, term])
  }

  async function save() {
    if (busyRef.current) return
    busyRef.current = true
    setSaving(true)
    setError(null)
    try {
      const indexes = selectedIndexes
      const created = await bulkCreateAvatars(businessId, selected.map(toApiDraft), {
        runId: run.id,
        draftIndexes: indexes,
      })
      // Saved drafts are no longer picks: they show as Saved and cannot be saved again.
      setJustSaved((current) => ({
        ...current,
        ...Object.fromEntries(indexes.map((draftIndex, n) => [draftIndex, created[n]?.id ?? ''])),
      }))
      setDrafts((current) => current.map((d, i) => (indexes.includes(i) ? { ...d, keep: false } : d)))
      onSaved(created)
    } catch (e) {
      setError(message(e, 'Could not save the avatars'))
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  async function discard() {
    if (busyRef.current) return
    busyRef.current = true
    setSaving(true)
    setError(null)
    try {
      await discardResearchRun(businessId, run.id)
      onDiscarded()
    } catch (e) {
      setError(message(e, 'Could not discard the research'))
      setSaving(false)
    } finally {
      busyRef.current = false
    }
  }

  async function markDone() {
    if (busyRef.current) return
    busyRef.current = true
    setSaving(true)
    setError(null)
    try {
      await markResearchRunDone(businessId, run.id)
      onDone()
    } catch (e) {
      setError(message(e, 'Could not finish the review'))
      setSaving(false)
    } finally {
      busyRef.current = false
    }
  }

  return (
    <section className="research-review" aria-labelledby="research-review-heading">
      <h2 id="research-review-heading" ref={headingRef} tabIndex={-1}>
        Review the research
      </h2>
      <p className="field-hint">
        {statusLabel(run.status, savedCount)}.{' '}
        {savedCount > 0
          ? `${savedCount} saved from this research so far. You can come back and save more any time; choose Mark as done when you have finished.`
          : 'Nothing is in your library until you save. Pick the avatars you want, edit anything, then choose Save selected.'}
      </p>

      <ResearchFindingsView run={run} />

      <section className="research-terms" aria-labelledby="research-terms-heading">
        <h3 id="research-terms-heading">Competitor terms</h3>
        <p className="field-hint">
          Hooks, angles and concepts that contain one of these are flagged below. Remove a term
          that is wrong or add one that is missing. This only changes the flags on this screen.
        </p>
        <ul aria-label="Competitor terms" className="research-terms-list">
          {terms.map((term) => (
            <li key={term}>
              {term}{' '}
              <button
                type="button"
                className="btn-outline"
                aria-label={`Remove term ${term}`}
                onClick={() => setTerms(terms.filter((t) => t !== term))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {run.ignoredCompetitorTerms.length > 0 && (
          <p className="field-hint">
            Ignored as common words: {run.ignoredCompetitorTerms.join(', ')}. If one is really a
            competitor's name, add it below to filter on it anyway.
          </p>
        )}
        <div className="field">
          <label htmlFor="research-new-term">Add a competitor term</label>
          <input
            id="research-new-term"
            value={newTerm}
            onChange={(event) => setNewTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addTerm()
              }
            }}
          />
          <button type="button" className="btn-outline" onClick={addTerm}>
            Add term
          </button>
        </div>
      </section>

      <section className="research-drafts" aria-labelledby="research-drafts-heading">
        <h3 id="research-drafts-heading">Avatar drafts</h3>
        <p>
          {library.length} of {MAX_BUYER_AVATARS} avatar slots used; {slotsLeft} left.{' '}
          <span>{selected.length} selected</span>
        </p>
        {savedCount > 0 && (
          <p className="field-hint">{savedCount} saved from this research.</p>
        )}
        {drafts.length === 0 && <p>The run produced no avatar drafts.</p>}
        <ul aria-label="Avatar drafts" className="avatar-list">
          {drafts.map((draft, index) => {
            const original = initialDrafts[index]
            const base = `research-draft-${index}`
            const flagged = flaggedTerms(draft, terms)
            const name = draft.name.trim().toLowerCase()
            const savedAs = savedBy.get(index)
            if (savedAs !== undefined) {
              const inLibrary = library.find((a) => a.id === savedAs)
              const shownName = inLibrary?.name ?? original.name
              return (
                <li key={index} className="avatar-item" aria-label={original.name}>
                  <div className="avatar-item-head">
                    <h4>{original.name}</h4>
                    <span className="avatar-badge">Saved</span>{' '}
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
            return (
              <li key={index} className="avatar-item" aria-label={original.name}>
                <div className="avatar-item-head">
                  <input
                    type="checkbox"
                    id={`${base}-keep`}
                    checked={draft.keep}
                    onChange={(event) => update(index, { keep: event.target.checked })}
                  />
                  <label htmlFor={`${base}-keep`}>Save {draft.name}</label>
                  <h4>{draft.name}</h4>
                  {draft.inferred && <span className="avatar-badge">Inferred</span>}
                </div>
                {libraryNames.has(name) && (
                  <p className="form-error">
                    An avatar with this name is already in your library. Rename it or leave it
                    out.
                  </p>
                )}
                {(nameCounts.get(name) ?? 0) > 1 && (
                  <p className="form-error">This has the same name as another draft here.</p>
                )}
                {flagged.length > 0 && (
                  <p className="research-warning">
                    Contains a competitor term: {flagged.join(', ')}
                  </p>
                )}
                <details>
                  <summary>Edit details</summary>
                  <div className="field">
                    <label htmlFor={`${base}-name`}>Name</label>
                    <input
                      id={`${base}-name`}
                      maxLength={60}
                      value={draft.name}
                      onChange={(event) => update(index, { name: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${base}-who`}>Who they are</label>
                    <textarea
                      id={`${base}-who`}
                      rows={3}
                      maxLength={600}
                      value={draft.who}
                      onChange={(event) => update(index, { who: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${base}-for`}>Who they buy for</label>
                    <select
                      id={`${base}-for`}
                      value={draft.purchaseFor}
                      onChange={(event) =>
                        update(index, { purchaseFor: event.target.value as 'self' | 'gift' })
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
                          update(index, { lists: { ...draft.lists, [key]: event.target.value } })
                        }
                      />
                      <span className="field-hint">One per line.</span>
                    </div>
                  ))}
                  <fieldset className="research-group">
                    <legend>Concepts</legend>
                    {draft.concepts.map((concept, n) => {
                      const patchConcept = (patch: Partial<typeof concept>) =>
                        update(index, {
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
                            <label htmlFor={`${base}-c${n}-desc`}>
                              Concept {n + 1} description
                            </label>
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
                              update(index, { concepts: draft.concepts.filter((_, i) => i !== n) })
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
                          update(index, {
                            concepts: [
                              ...draft.concepts,
                              { name: '', pillar: 'offer', description: '' },
                            ],
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

      {tooMany && (
        <p className="form-error">
          You selected {selected.length} avatars but there {slotsLeft === 1 ? 'is' : 'are'} only{' '}
          {slotsLeft} {plural(slotsLeft, 'slot', 'slots')} left. Deselect some, or delete avatars
          from your library first.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}

      <form
        className="avatar-actions"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void save()
        }}
      >
        <button type="submit" className="btn-outline btn-gold" disabled={!canSave}>
          Save selected
        </button>
        {savedCount > 0 ? (
          <button
            type="button"
            className="btn-outline"
            disabled={saving}
            onClick={() => setConfirmingDone(true)}
          >
            Mark as done
          </button>
        ) : (
          <button
            type="button"
            className="btn-outline"
            disabled={saving}
            onClick={() => setConfirmingDiscard(true)}
          >
            Discard
          </button>
        )}
        <button type="button" className="btn-outline" onClick={() => leave(onBack)}>
          Back to avatars
        </button>
      </form>

      {confirmingDone && (
        <fieldset className="avatar-confirm">
          <legend className="visually-hidden">Confirm finishing this review</legend>
          <p>
            Mark this research as done? Once it is done, no more avatars can be saved from it until you reopen it. The
            {' '}
            {savedCount} {plural(savedCount, 'avatar', 'avatars')} you saved stay in your library.
            {dirty && ' Any unsaved changes will be lost.'}
          </p>
          <div className="avatar-actions">
            <button
              type="button"
              className="btn-outline btn-gold"
              disabled={saving}
              onClick={() => void markDone()}
            >
              Yes, mark as done
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={saving}
              onClick={() => setConfirmingDone(false)}
            >
              Keep reviewing
            </button>
          </div>
        </fieldset>
      )}

      {confirmingDiscard && (
        <fieldset className="avatar-confirm">
          <legend className="visually-hidden">Confirm discarding this research</legend>
          <p>
            Discard this research? Nothing will be saved to your library. The run stays in your
            list of past runs.
          </p>
          <div className="avatar-actions">
            <button
              type="button"
              className="btn-outline btn-danger"
              disabled={saving}
              onClick={() => void discard()}
            >
              Yes, discard
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={saving}
              onClick={() => setConfirmingDiscard(false)}
            >
              Keep reviewing
            </button>
          </div>
        </fieldset>
      )}
    </section>
  )
}
