import type { FormEvent } from 'react'
import { ArrowLeftIcon, CircleCheckIcon, SaveIcon } from './researchHubIcons'

// Save selected, Mark as done (or Discard while nothing is saved) and Back to avatars. Each
// opens the same confirmations and does the same thing as before; only the look changed.
export function ResearchDashActions({
  canSave,
  saving,
  savedCount,
  onSave,
  onAskDone,
  onAskDiscard,
  onBack,
}: {
  canSave: boolean
  saving: boolean
  savedCount: number
  onSave: () => void
  onAskDone: () => void
  onAskDiscard: () => void
  onBack: () => void
}) {
  return (
    <form
      className="dash-actions"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        onSave()
      }}
    >
      <button type="button" className="dash-btn dash-btn-quiet" onClick={onBack}>
        <ArrowLeftIcon size={18} />
        Back to avatars
      </button>
      <div className="dash-actions-main">
        {/* Separate keys: a new element, so the colour does not fade from Discard's. */}
        {savedCount > 0 ? (
          <button
            key="done"
            type="button"
            className="dash-btn dash-btn-emerald"
            disabled={saving}
            onClick={onAskDone}
          >
            <CircleCheckIcon size={18} />
            Mark as done
          </button>
        ) : (
          <button
            key="discard"
            type="button"
            className="dash-btn dash-btn-ghost"
            disabled={saving}
            onClick={onAskDiscard}
          >
            Discard
          </button>
        )}
        <button
          type="submit"
          className="dash-btn dash-btn-gold"
          disabled={!canSave}
          aria-busy={saving}
        >
          <SaveIcon size={18} />
          Save selected
        </button>
      </div>
    </form>
  )
}
