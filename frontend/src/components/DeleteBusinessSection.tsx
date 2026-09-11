import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, deleteBusiness, listCampaigns, type Campaign } from '../lib/api'

// Lives on BusinessDetailPage only, never the dashboard list — deleting a
// business is a decision made while looking at it, not a stray click in a
// list row (confirmed with the user, business-delete build step).
//
// The typed-name confirmation gate is a new pattern for this app — every
// other destructive action here (pause/delete campaign, CampaignsSection)
// skips a confirmation dialog on purpose, since those are either always
// reversible on Meta's side or already blocked outright once a campaign's
// ever gone live. A business carries everything underneath it, so this
// one gets the heavier gate.
export function DeleteBusinessSection({
  businessId,
  businessName,
}: {
  businessId: string
  businessName: string
}) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  // Fetched fresh when the confirm panel opens, not reused from whatever
  // the page already has in memory — BusinessDetailPage's own `campaigns`
  // state stops updating once onboarding is past the campaign-gate step
  // (see its CampaignsSection usage), so it can't be trusted here.
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openConfirm() {
    setConfirming(true)
    setError(null)
    setNameInput('')
    try {
      setCampaigns(await listCampaigns(businessId))
    } catch {
      // Non-fatal — the confirmation gate still works, it just won't be
      // able to show the "campaigns remain on Meta" note below.
      setCampaigns(null)
    }
  }

  function cancel() {
    setConfirming(false)
    setError(null)
    setNameInput('')
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteBusiness(businessId)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete business.')
    } finally {
      setDeleting(false)
    }
  }

  if (!confirming) {
    return (
      <section>
        <button type="button" onClick={() => void openConfirm()}>
          Delete business
        </button>
      </section>
    )
  }

  const hasMetaCampaigns = campaigns?.some((c) => c.metaCampaignId !== null) ?? false
  const nameMatches = nameInput === businessName

  return (
    <section>
      <h2>Delete business</h2>
      <p>
        This will remove "{businessName}" from your business list. This can't be undone
        from here.
      </p>
      {hasMetaCampaigns && (
        <p>
          This business has campaigns that were published to Meta — they'll remain
          (paused) in your Meta account after this business is deleted.
        </p>
      )}
      <div className="field">
        <label htmlFor="delete-business-confirm">
          Type <strong>{businessName}</strong> to confirm
        </label>
        <input
          id="delete-business-confirm"
          value={nameInput}
          onChange={(event) => setNameInput(event.target.value)}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={!nameMatches || deleting}
      >
        {deleting ? 'Deleting…' : 'Permanently delete business'}
      </button>
      <button type="button" onClick={cancel} disabled={deleting}>
        Cancel
      </button>
    </section>
  )
}
