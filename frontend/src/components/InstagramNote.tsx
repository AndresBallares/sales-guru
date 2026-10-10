import { useEffect, useState } from 'react'
import { ApiError, getMetaConnection, refreshMetaInstagram } from '../lib/api'

export const NO_INSTAGRAM_NOTE =
  "No Instagram account linked to your Page — ads won't run on Instagram. Connect one in Meta Business Suite."

// Shown next to Publish when the connected Page has no Instagram account, so
// the user knows ads will run on Facebook only. "Check again" re-reads the
// Page's Instagram account from Meta without reconnecting. Renders nothing
// while loading, when an account is linked, or when there is no connection yet.
export function InstagramNote({ businessId }: { businessId: string }) {
  const [missing, setMissing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMetaConnection(businessId)
      .then((connection) => {
        if (!cancelled) setMissing(connection.pageId !== null && connection.instagramUserId === null)
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
      const connection = await refreshMetaInstagram(businessId)
      setMissing(connection.instagramUserId === null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check Instagram.')
    } finally {
      setChecking(false)
    }
  }

  if (!missing) return null
  return (
    <div className="form-warning" role="status">
      <p>{NO_INSTAGRAM_NOTE}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="link-button" onClick={() => void handleCheckAgain()} disabled={checking}>
        {checking ? 'Checking…' : 'Check again'}
      </button>
    </div>
  )
}
