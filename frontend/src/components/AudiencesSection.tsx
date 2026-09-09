import { useCallback, useEffect, useState } from 'react'
import { ApiError, listAudiences, listCampaigns, type Audience } from '../lib/api'
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
  // The campaign this section's onboarding step exists to unblock — the
  // business's one campaign still missing an audience (there's only ever
  // one at this point in the stepper, see BusinessDetailPage). Passed to
  // "Add an audience" below so the backend can auto-attach the new
  // audience to it (app/services/campaign_readiness.py) instead of
  // leaving the campaign to be filled in manually.
  const [pendingCampaignId, setPendingCampaignId] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [loaded, campaigns] = await Promise.all([
        listAudiences(businessId),
        listCampaigns(businessId),
      ])
      setAudiences(loaded)
      onAudiencesChange?.(loaded)
      setPendingCampaignId(campaigns.find((campaign) => campaign.audienceId === null)?.id)
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
        <AudienceForm
          businessId={businessId}
          campaignId={pendingCampaignId}
          onSaved={() => void refresh()}
        />
      </section>
    </>
  )
}
