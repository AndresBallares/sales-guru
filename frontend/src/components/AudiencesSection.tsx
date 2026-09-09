import { useCallback, useEffect, useState } from 'react'
import { ApiError, listAudiences, type Audience } from '../lib/api'
import { AudienceForm } from './AudienceForm'

export function AudiencesSection({
  businessId,
  onAudiencesChange,
}: {
  businessId: string
  onAudiencesChange?: (audiences: Audience[]) => void
}) {
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await listAudiences(businessId)
      setAudiences(loaded)
      onAudiencesChange?.(loaded)
      setListError(null)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load audiences.')
    } finally {
      setLoading(false)
    }
  }, [businessId, onAudiencesChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <>
      <section>
        <h2>Audiences</h2>
        {loading && <p>Loading…</p>}
        {listError && (
          <p className="form-error" role="alert">
            {listError}
          </p>
        )}
        {!loading && !listError && audiences.length === 0 && (
          <p>No audiences yet — add your first one below.</p>
        )}
        <ul>
          {audiences.map((audience) => (
            <li key={audience.id}>{audience.description}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Add an audience</h2>
        <AudienceForm businessId={businessId} onSaved={() => void refresh()} />
      </section>
    </>
  )
}
