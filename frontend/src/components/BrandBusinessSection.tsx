import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Business } from '../lib/api'
import { BrandProfileSection } from './BrandProfileSection'
import { ArrowRightIcon } from './icons'

export interface BrandFocusRequest {
  businessId: string
  // Changes on every request, so asking for the same business twice works.
  nonce: number
}

// The Brand section on the dashboard, under Company Information. A brand
// profile belongs to one business, so with several businesses a picker chooses
// which one (the first by default); with exactly one it is simply that one.
//
// It is also step two of onboarding: after a business is created (or the
// business page sends someone back here) `focusRequest` selects that business
// and puts the cursor in its form; after the profile is saved, a confirmation
// offers the next step, the business's Meta connection settings, or to skip
// that for now and go straight on to its campaigns.
export function BrandBusinessSection({
  businesses,
  focusRequest,
  onContinue,
  onSelectedChange,
}: {
  businesses: Pick<Business, 'id' | 'name'>[]
  focusRequest?: BrandFocusRequest | null
  onContinue?: (businessId: string) => void
  // Reports which business the section is showing, so the page's Next can follow it.
  onSelectedChange?: (businessId: string) => void
}) {
  const [pickedId, setPickedId] = useState('')
  const [focusedNonce, setFocusedNonce] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => {
    if (!focusRequest) return
    setPickedId(focusRequest.businessId)
    setFocusedNonce(focusRequest.nonce)
    setSavedId(null)
    document.getElementById('brand')?.scrollIntoView?.({ block: 'start' })
  }, [focusRequest])

  const selectedId = businesses.find((b) => b.id === pickedId)?.id ?? businesses[0]?.id ?? ''
  const selected = businesses.find((b) => b.id === selectedId)

  useEffect(() => {
    onSelectedChange?.(selectedId)
  }, [selectedId, onSelectedChange])

  if (businesses.length === 0) {
    return (
      <section>
        <h2>Brand</h2>
        <p>Add a business above, then set up its brand profile here.</p>
      </section>
    )
  }

  return (
    <BrandProfileSection
      businessId={selectedId}
      autoFocusForm={focusRequest?.businessId === selectedId && focusedNonce === focusRequest.nonce}
      onSaved={() => setSavedId(selectedId)}
      summaryExtra={
        savedId === selectedId && onContinue ? (
          <div className="flow-callout" role="status">
            <p>
              <strong>Brand profile saved.</strong> Every campaign for{' '}
              {selected?.name ?? 'this business'} will now use it to keep its strategy and ads on
              brand.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="btn-outline btn-gold"
                onClick={() => onContinue(selectedId)}
              >
                Continue to Meta connection settings
                <ArrowRightIcon />
              </button>
              {/* Or skip Meta for now: on to this business's campaigns (the same
                  soft gate as the Meta step's own "Skip for now"). */}
              <Link className="cancel-link" to={`/businesses/${selectedId}?skipMeta=1`}>
                Skip for now
              </Link>
            </div>
          </div>
        ) : null
      }
      headerExtra={
        businesses.length > 1 ? (
          <div className="field">
            <label htmlFor="brand-business-pick">Business</label>
            <select
              id="brand-business-pick"
              value={selectedId}
              onChange={(event) => {
                setPickedId(event.target.value)
                setFocusedNonce(null)
              }}
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        ) : null
      }
    />
  )
}
