import { useId, useState } from 'react'
import { SaveIcon } from './icons'
import {
  ApiError,
  refreshMetaInstagram,
  setMetaInstagramAccount,
  type MetaConnection,
} from '../lib/api'

function describeAccount(connection: MetaConnection): string {
  if (connection.instagramUserIdManual) {
    return `Instagram account ${connection.instagramUserIdManual} (entered by you).`
  }
  if (connection.instagramUserIdDiscovered) {
    return `Instagram account ${connection.instagramUserIdDiscovered} (found on your Page).`
  }
  return 'No Instagram account in use.'
}

// The Instagram account ads are published as. Found on the Page automatically
// when Meta lets us read it; an ID entered here wins over that. Meta checks an
// entered ID before it is saved.
export function InstagramAccountForm({
  businessId,
  connection,
  onUpdated,
  showCheckAgain = false,
}: {
  businessId: string
  connection: MetaConnection
  onUpdated: (connection: MetaConnection) => void
  showCheckAgain?: boolean
}) {
  const inputId = useId()
  const [value, setValue] = useState(connection.instagramUserIdManual ?? '')
  const [busy, setBusy] = useState<'save' | 'clear' | 'check' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: 'save' | 'clear' | 'check', action: () => Promise<MetaConnection>) {
    setBusy(kind)
    setError(null)
    try {
      const updated = await action()
      setValue(updated.instagramUserIdManual ?? '')
      onUpdated(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the Instagram account.')
    } finally {
      setBusy(null)
    }
  }

  const trimmed = value.trim()
  const unchanged = trimmed === (connection.instagramUserIdManual ?? '')

  return (
    <div className="instagram-account">
      <p>{describeAccount(connection)}</p>
      <div className="field">
        <label htmlFor={inputId}>Instagram account ID</label>
        <input
          id={inputId}
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="17841400000000000"
        />
        <p className="field-hint">
          Optional. Used instead of the account found on your Page. Meta checks it before it is
          saved.
        </p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button
          type="button"
          className="btn-outline btn-gold"
          onClick={() => void run('save', () => setMetaInstagramAccount(businessId, trimmed))}
          disabled={busy !== null || trimmed === '' || unchanged}
        >
          <SaveIcon />
          {busy === 'save' ? 'Checking with Meta…' : 'Save account ID'}
        </button>
        {connection.instagramUserIdManual && (
          <button
            type="button"
            className="link-button"
            onClick={() => void run('clear', () => setMetaInstagramAccount(businessId, null))}
            disabled={busy !== null}
          >
            {busy === 'clear' ? 'Clearing…' : 'Use the one found on my Page'}
          </button>
        )}
        {showCheckAgain && (
          <button
            type="button"
            className="link-button"
            onClick={() => void run('check', () => refreshMetaInstagram(businessId))}
            disabled={busy !== null}
          >
            {busy === 'check' ? 'Checking…' : 'Check again'}
          </button>
        )}
      </div>
    </div>
  )
}
