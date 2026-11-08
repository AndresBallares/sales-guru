import { useState } from 'react'
import { ApiError, reconnectMeta } from '../lib/api'

// Signs the business in to Meta again (the existing reconnect: same scopes, the token
// replaced, the ad account, Page and Pixel kept) and sends the browser to Meta's login.
export function ReconnectMetaButton({ businessId }: { businessId: string }) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reconnect() {
    setOpening(true)
    setError(null)
    try {
      const { authorizationUrl } = await reconnectMeta(businessId)
      window.location.href = authorizationUrl
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start reconnecting Meta.')
      setOpening(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-outline btn-gold"
        onClick={() => void reconnect()}
        disabled={opening}
      >
        {opening ? 'Opening Meta…' : 'Reconnect Meta'}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
