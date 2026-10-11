import { useState } from 'react'
import type { Business } from '../lib/api'
import { BusinessEditForm } from './BusinessEditForm'

// Lives next to "Create business" and "Delete business" on the dashboard
// (moved there from the business page, 2026-10-09). The dashboard lists
// several businesses, so the button opens a panel that asks which one, then
// shows the same edit form the business page used to show inline.
//
// Renders a fragment: the trigger button sits in the parent's button row,
// and the panel wraps onto its own full-width line below it.
export function EditBusinessSection({
  businesses,
  onSaved,
}: {
  businesses: Business[]
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  // '' until one is picked from the dropdown; a lone business counts as
  // picked, including when the list finishes loading after the panel opened.
  const [pickedId, setPickedId] = useState('')

  const selectedId = pickedId || (businesses.length === 1 ? businesses[0].id : '')
  const business = businesses.find((b) => b.id === selectedId) ?? null

  function close() {
    setOpen(false)
    setPickedId('')
  }

  return (
    <>
      {/* Never disabled, same as "Delete business": with nothing to edit the
          panel says so instead. */}
      <button type="button" onClick={() => setOpen(true)}>
        Edit business
      </button>
      {open && (
        <section className="edit-business-panel" aria-labelledby="edit-business-heading">
          <h2 id="edit-business-heading">Edit business</h2>
          {businesses.length === 0 ? (
            <>
              <p>You have no businesses to edit.</p>
              <button type="button" onClick={close}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="edit-business-pick">Business to edit</label>
                <select
                  id="edit-business-pick"
                  value={selectedId}
                  onChange={(event) => setPickedId(event.target.value)}
                >
                  <option value="">Choose a business…</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              {business ? (
                <BusinessEditForm
                  key={business.id}
                  businessId={business.id}
                  business={business}
                  onSaved={() => {
                    close()
                    onSaved()
                  }}
                  onCancel={close}
                />
              ) : (
                <button type="button" onClick={close}>
                  Cancel
                </button>
              )}
            </>
          )}
        </section>
      )}
    </>
  )
}
