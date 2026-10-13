import { useState } from 'react'
import type { Business } from '../lib/api'
import { BrandProfileSection } from './BrandProfileSection'

// The Brand section on the dashboard, under Company Information. A brand
// profile belongs to one business, so with several businesses a picker chooses
// which one (the first by default); with exactly one it is simply that one.
export function BrandBusinessSection({
  businesses,
}: {
  businesses: Pick<Business, 'id' | 'name'>[]
}) {
  const [pickedId, setPickedId] = useState('')
  const selectedId = businesses.find((b) => b.id === pickedId)?.id ?? businesses[0]?.id ?? ''

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
      headerExtra={
        businesses.length > 1 ? (
          <div className="field">
            <label htmlFor="brand-business-pick">Business</label>
            <select
              id="brand-business-pick"
              value={selectedId}
              onChange={(event) => setPickedId(event.target.value)}
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
