import { useEffect, useState } from 'react'
import {
  ApiError,
  getMetaConnection,
  refreshMetaInstagram,
  type MetaConnection,
} from '../lib/api'
import { InstagramAccountForm } from './InstagramAccountForm'

export const NO_INSTAGRAM_NOTE =
  "No Instagram account linked to your Page — ads won't run on Instagram. Connect one in Meta Business Suite."

// Shown next to Publish when no Instagram account is in use, so the user knows
// ads will run on Facebook only. "Check again" re-reads the Page's Instagram
// account from Meta without reconnecting; the account ID can also be entered by
// hand. Renders nothing while loading, when an account is in use, or when there
// is no connection yet.
export function InstagramNote({ businessId }: { businessId: string }) {
  const [connection, setConnection] = useState<MetaConnection | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMetaConnection(businessId)
      .then((loaded) => {
        if (!cancelled) setConnection(loaded)
      })
      .catch(() => {
        // No connection, or the lookup failed: say nothing rather than guess.
      })
    return () => {
      cancelled = true
    }
  }, [businessId])

  async function handleCheckAgain() {
    setChecking(true)
    setError(null)
    try {
      setConnection(await refreshMetaInstagram(businessId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check Instagram.')
    } finally {
      setChecking(false)
    }
  }

  if (connection === null || connection.pageId === null || connection.instagramUserId !== null) {
    return null
  }
  return (
    <div className="form-warning" role="status">
      <p>{NO_INSTAGRAM_NOTE}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="link-button"
        onClick={() => void handleCheckAgain()}
        disabled={checking}
      >
        {checking ? 'Checking…' : 'Check again'}
      </button>
      <details>
        <summary>Enter the Instagram account ID yourself</summary>
        <InstagramAccountForm
          businessId={businessId}
          connection={connection}
          onUpdated={setConnection}
        />
      </details>
    </div>
  )
}
