import { useCallback, useEffect, useState } from 'react'
import { ApiError, getBrandProfile, type BrandProfile } from '../lib/api'
import { BrandProfileForm } from './BrandProfileForm'

// The "Brand DNA" onboarding step (PRD.md §5 step 3.5) — shown right
// after Company Information, ahead of Campaigns (same "one gate at a
// time" pattern as BusinessDetailPage's other steps). Doubles as the
// later "editable from the business page" view once a profile exists —
// same component, not a separate onboarding-only form.
export function BrandProfileSection({
  businessId,
  onProfileChange,
}: {
  businessId: string
  onProfileChange?: (profile: BrandProfile | null) => void
}) {
  const [profile, setProfile] = useState<BrandProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await getBrandProfile(businessId)
      setProfile(loaded)
      onProfileChange?.(loaded)
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setProfile(null)
        onProfileChange?.(null)
        setError(null)
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load brand profile.')
      }
    } finally {
      setLoading(false)
    }
  }, [businessId, onProfileChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) {
    return (
      <section>
        <h2>Brand</h2>
        <p>Loading…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section>
        <h2>Brand</h2>
        <p className="form-error" role="alert">
          {error}
        </p>
      </section>
    )
  }

  if (profile && !editing) {
    return (
      <section>
        <h2>Brand</h2>
        <p>{profile.description}</p>
        <button type="button" onClick={() => setEditing(true)}>
          Edit brand profile
        </button>
      </section>
    )
  }

  return (
    <section>
      <h2>Brand</h2>
      <p>
        A couple of quick questions so the AI writes strategy and ad copy in
        your voice, not a generic one.
      </p>
      <BrandProfileForm
        businessId={businessId}
        profile={profile ?? undefined}
        onSaved={(saved) => {
          setProfile(saved)
          onProfileChange?.(saved)
          setEditing(false)
        }}
        onCancel={profile ? () => setEditing(false) : undefined}
      />
    </section>
  )
}
