import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { PencilIcon } from './icons'
import { ApiError, getBrandProfile, type BrandProfile } from '../lib/api'
import { BrandProfileForm } from './BrandProfileForm'

// The "Brand DNA" section (PRD.md §5 step 3.5): the short questionnaire the
// Strategist/Creative Agents ground into, and its later edit view — the same
// component for both. It now lives on the dashboard, under Company
// Information, for one business at a time; `headerExtra` is where the
// dashboard puts its business picker, right under the heading.
export function BrandProfileSection({
  businessId,
  onProfileChange,
  headerExtra,
}: {
  businessId: string
  onProfileChange?: (profile: BrandProfile | null) => void
  headerExtra?: ReactNode
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

  // Switching to another business never carries an open edit over to it.
  useEffect(() => {
    setEditing(false)
  }, [businessId])

  if (loading) {
    return (
      <section>
        <h2>Brand</h2>
        {headerExtra}
        <p>Loading…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section>
        <h2>Brand</h2>
        {headerExtra}
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
        {headerExtra}
        <p>{profile.description}</p>
        <button type="button" className="btn-outline" onClick={() => setEditing(true)}>
          <PencilIcon />
          Edit brand profile
        </button>
      </section>
    )
  }

  return (
    <section>
      <h2>Brand</h2>
      {headerExtra}
      <p>
        A couple of quick questions so the AI writes strategy and ad copy in
        your voice, not a generic one.
      </p>
      <BrandProfileForm
        key={businessId}
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
