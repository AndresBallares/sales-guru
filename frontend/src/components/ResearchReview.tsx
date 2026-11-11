import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  bulkCreateAvatars,
  discardResearchRun,
  markResearchRunDone,
  type BuyerAvatar,
  type BuyerAvatarDraft,
  type ResearchRun,
} from '../lib/api'
import { MAX_BUYER_AVATARS, linesOf } from '../lib/avatarFields'
import { avatarDraftFrom, type ReviewDraft } from '../lib/research'
import { ResearchDashActions } from './ResearchDashActions'
import { ResearchDashAvatars } from './ResearchDashAvatars'
import { ResearchDashCompetitors } from './ResearchDashCompetitors'
import { ResearchDashEvidence } from './ResearchDashEvidence'
import { ResearchDashGaps } from './ResearchDashGaps'
import {
  MarketOpportunityPanel,
  ResearchDashHeader,
  ResearchMetricCards,
} from './ResearchDashOverview'
import { ResearchDashProblems } from './ResearchDashProblems'
import { ResearchDashSolutions } from './ResearchDashSolutions'
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
  const [notice, setNotice] = useState<string | null>(null)
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

  function addTerm(raw: string) {
    const term = raw.trim()
    if (term === '' || terms.some((t) => t.toLowerCase() === term.toLowerCase())) return
    setTerms([...terms, term])
  }

  async function save() {
    if (busyRef.current) return
    busyRef.current = true
    setSaving(true)
    setError(null)
    setNotice(null)
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
      setNotice(`Saved ${created.length} ${plural(created.length, 'avatar', 'avatars')} to your library.`)
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

  const intro =
    savedCount > 0
      ? `${savedCount} saved from this research so far. You can come back and save more any time; choose Mark as done when you have finished.`
      : 'Nothing is in your library until you save. Pick the avatars you want, edit anything, then choose Save selected.'

  return (
    <section className="research-review research-dash" aria-labelledby="research-review-heading">
      <ResearchDashHeader run={run} savedCount={savedCount} intro={intro} headingRef={headingRef} />
      <ResearchMetricCards run={run} />
      <MarketOpportunityPanel run={run} />

      <ResearchDashEvidence run={run} />
      <div className="dash-pair">
        <ResearchDashProblems problems={problems} solutions={solutions} />
        <ResearchDashSolutions solutions={solutions} />
      </div>
      <ResearchDashGaps gaps={findings.gaps ?? []} problems={problems} />

      <ResearchDashCompetitors
        terms={terms}
        ignored={run.ignoredCompetitorTerms}
        onRemove={(term) => setTerms(terms.filter((t) => t !== term))}
        onAdd={addTerm}
      />

      <ResearchDashAvatars
        drafts={drafts}
        initialDrafts={initialDrafts}
        savedBy={savedBy}
        library={library}
        terms={terms}
        savedCount={savedCount}
        selectedCount={selected.length}
        slotsLeft={slotsLeft}
        onChange={update}
        onOpenAvatar={onOpenAvatar}
      />

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
      <p className="dash-notice" role="status">
        {saving ? 'Saving…' : notice}
      </p>

      <ResearchDashActions
        canSave={canSave}
        saving={saving}
        savedCount={savedCount}
        onSave={() => void save()}
        onAskDone={() => setConfirmingDone(true)}
        onAskDiscard={() => setConfirmingDiscard(true)}
        onBack={() => leave(onBack)}
      />

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
