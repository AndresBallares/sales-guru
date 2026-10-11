import { useEffect, useState } from 'react'
import { ApiError, deleteBusiness, listCampaigns, type Business, type Campaign } from '../lib/api'

// Lives next to "Create business" on the dashboard (moved there from the
// business page, 2026-10-09). Deleting is still a deliberate two-step act:
// the button only opens a panel where you pick the business and type its
// name, never a one-click action on a list row.
//
// The typed-name confirmation gate is a new pattern for this app — every
// other destructive action here (pause/delete campaign, CampaignsSection)
// skips a confirmation dialog on purpose, since those are either always
// reversible on Meta's side or already blocked outright once a campaign's
// ever gone live. A business carries everything underneath it, so this
// one gets the heavier gate.
//
// Renders a fragment: the trigger button sits in the parent's button row,
// and the confirm panel wraps onto its own full-width line below it.
export function DeleteBusinessSection({
  businesses,
  onDeleted,
}: {
  businesses: Pick<Business, 'id' | 'name'>[]
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  // '' until one is picked from the dropdown; a lone business counts as
  // picked (see selectedId), including when the list finishes loading after
  // the panel was opened.
  const [pickedId, setPickedId] = useState('')
  // Fetched fresh for the selected business, not reused from page state —
  // the dashboard never loads campaigns itself. Keyed by business id so a
  // stale answer for a previous pick is never shown.
  const [loaded, setLoaded] = useState<{ id: string; campaigns: Campaign[] | null } | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedId = pickedId || (businesses.length === 1 ? businesses[0].id : '')
  const business = businesses.find((b) => b.id === selectedId) ?? null
  const campaigns = loaded?.id === selectedId ? loaded.campaigns : null

  useEffect(() => {
    if (!confirming || !selectedId) return
    let current = true
    listCampaigns(selectedId)
      .then((list) => current && setLoaded({ id: selectedId, campaigns: list }))
      // Non-fatal — the confirmation gate still works, it just won't be
      // able to show the "campaigns remain on Meta" note below.
      .catch(() => current && setLoaded({ id: selectedId, campaigns: null }))
    return () => {
      current = false
    }
  }, [confirming, selectedId])

  function pickBusiness(id: string) {
    setPickedId(id)
    setNameInput('')
    setError(null)
  }

  function openConfirm() {
    setConfirming(true)
    pickBusiness('')
  }

  function cancel() {
    setConfirming(false)
    pickBusiness('')
  }

  async function handleDelete() {
    if (!business) return
    setDeleting(true)
    setError(null)
    try {
      await deleteBusiness(business.id)
      cancel()
      onDeleted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete business.')
    } finally {
      setDeleting(false)
    }
  }

  const hasMetaCampaigns = campaigns?.some((c) => c.metaCampaignId !== null) ?? false
  const nameMatches = business !== null && nameInput === business.name

  return (
    <>
      {/* Never disabled: it flips state as the business list loads, and the
          button's colour fade is caught mid-way by the accessibility scan.
          With nothing to delete, the panel says so instead. */}
      <button type="button" onClick={openConfirm}>
        Delete business
      </button>
      {confirming && (
        <section className="delete-business-panel">
          <h2>Delete business</h2>
          {businesses.length === 0 ? (
            <p>You have no businesses to delete.</p>
          ) : (
            <div className="field">
              <label htmlFor="delete-business-pick">Business to delete</label>
              <select
                id="delete-business-pick"
                value={selectedId}
                onChange={(event) => pickBusiness(event.target.value)}
              >
                <option value="">Choose a business…</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {business && (
            <>
              <p>
                This will remove "{business.name}" from your business list. This can't be
                undone from here.
              </p>
              {hasMetaCampaigns && (
                <p>
                  This business has campaigns that were published to Meta — they'll remain
                  (paused) in your Meta account after this business is deleted.
                </p>
              )}
              <div className="field">
                <label htmlFor="delete-business-confirm">
                  Type <strong>{business.name}</strong> to confirm
                </label>
                <input
                  id="delete-business-confirm"
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                />
              </div>
            </>
          )}
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
      )}
    </>
  )
}
