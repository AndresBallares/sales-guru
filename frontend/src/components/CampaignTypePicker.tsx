import { useEffect, useId, useState } from 'react'
import { ApiError, getCampaignTypes, getCampaignTypesForObjective } from '../lib/api'
import type { CampaignType, CampaignTypeOptions, Objective } from '../lib/api'

// Give a `campaignId` for a saved campaign, or an `objective` on the create form, where the
// campaign doesn't exist yet. Remount (key) the picker when the objective changes.
interface Props {
  businessId: string
  campaignId?: string
  objective?: Objective
  // Show the "Campaign type" label (the create form); the card's row supplies its own.
  showLabel?: boolean
  // The type chosen so far; undefined until the recommendation is preselected.
  value: CampaignType | undefined
  onChange: (type: CampaignType) => void
}

// The Campaign type dropdown: a native <select> (every dropdown in the app is one). It only
// preselects the backend's recommendation; the user can always pick another available type.
export function CampaignTypePicker({
  businessId,
  campaignId,
  objective,
  showLabel,
  value,
  onChange,
}: Props) {
  const [loaded, setLoaded] = useState<CampaignTypeOptions | null>(null)
  const [failed, setFailed] = useState(false)
  const selectId = useId()
  const hasValue = value !== undefined

  useEffect(() => {
    let cancelled = false
    const request =
      campaignId !== undefined
        ? getCampaignTypes(businessId, campaignId)
        : getCampaignTypesForObjective(businessId, objective ?? 'SALES')
    request
      .then((options) => {
        if (cancelled) return
        setLoaded(options)
        if (!hasValue) onChange(options.recommended)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFailed(true)
        if (!(err instanceof ApiError)) console.error(err)
      })
    return () => {
      cancelled = true
    }
    // Fetched once per campaign; a later change of value must not refetch or re-preselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, campaignId, objective])

  if (failed) {
    return <p role="alert">We couldn't load the campaign types. Reload the page to try again.</p>
  }
  if (!loaded) return null

  const selected = loaded.options.find((option) => option.type === value)
  return (
    <div className="campaign-type-picker">
      <label htmlFor={selectId} className={showLabel ? undefined : 'visually-hidden'}>
        Campaign type
      </label>
      <select
        id={selectId}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value as CampaignType)}
      >
        {loaded.options.map((option) => (
          <option key={option.type} value={option.type} disabled={!option.available}>
            {option.available
              ? `${option.label}${option.type === loaded.recommended ? ' (recommended)' : ''}`
              : `${option.label} — ${unavailableNote(option.reason)}`}
          </option>
        ))}
      </select>
      {selected && <p className="campaign-type-description">{selected.description}</p>}
      {selected?.warning && (
        <p role="note" className="campaign-type-warning">
          {selected.warning}
        </p>
      )}
    </div>
  )
}

// "Geo Targeting is coming soon." -> "coming soon"; any other reason is shown as it came.
function unavailableNote(reason: string | null): string {
  if (reason && /coming soon/i.test(reason)) return 'coming soon'
  return reason ?? 'not available'
}
