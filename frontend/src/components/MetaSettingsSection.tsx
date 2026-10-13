import { useEffect, useState } from 'react'
import { RefreshIcon } from './icons'
import {
  ApiError,
  finalizeMetaConnection,
  getMetaConnection,
  listMetaPages,
  reconnectMeta,
  type MetaConnection,
  type MetaPage,
} from '../lib/api'
import { InstagramAccountForm } from './InstagramAccountForm'

// Meta connection settings, reachable once setup is complete: reconnect Meta
// (new token and current permissions, same ad account and Page), choose another
// Page, and which Instagram account ads run as. Collapsed by default, open right
// after a reconnect; renders nothing without a connection.
export function MetaSettingsSection({
  businessId,
  outcome = null,
}: {
  businessId: string
  // The ?meta= outcome the OAuth round-trip came back with, if any.
  outcome?: string | null
}) {
  const [connection, setConnection] = useState<MetaConnection | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<MetaPage[] | null>(null)
  const [loadingPages, setLoadingPages] = useState(false)
  const [selectedPageId, setSelectedPageId] = useState('')
  const [savingPage, setSavingPage] = useState(false)

  useEffect(() => {
    let cancelled = false
    getMetaConnection(businessId)
      .then((loaded) => {
        if (!cancelled) setConnection(loaded)
      })
      .catch(() => {
        // No connection yet: nothing to configure.
      })
    return () => {
      cancelled = true
    }
  }, [businessId])

  async function handleReconnect() {
    setReconnecting(true)
    setError(null)
    try {
      const { authorizationUrl } = await reconnectMeta(businessId)
      window.location.href = authorizationUrl
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start reconnecting Meta.')
      setReconnecting(false)
    }
  }

  async function handleChangePage() {
    setLoadingPages(true)
    setError(null)
    try {
      setPages(await listMetaPages(businessId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your Pages.')
    } finally {
      setLoadingPages(false)
    }
  }

  async function handleSavePage() {
    if (connection === null || connection.adAccountId === null) return
    setSavingPage(true)
    setError(null)
    try {
      setConnection(
        await finalizeMetaConnection(businessId, {
          adAccountId: connection.adAccountId,
          pageId: selectedPageId,
        }),
      )
      setPages(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the Page.')
    } finally {
      setSavingPage(false)
    }
  }

  if (connection === null || connection.pageId === null) return null
  return (
    <section aria-labelledby="meta-settings-heading">
      <details open={outcome === 'reconnected' || undefined}>
        <summary id="meta-settings-heading">Meta connection settings</summary>
        {outcome === 'reconnected' && (
          <p role="status">
            Meta reconnected — the connection now has the current permissions. Your ad account
            and Page are unchanged.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="meta-step">
          <p>
            Ad account <strong>{connection.adAccountId}</strong>, Page{' '}
            <strong>{connection.pageId}</strong>.
          </p>
          <p className="field-hint">
            Reconnecting signs in to Meta again to refresh the access token and permissions. Your
            ad account, Page and Pixel stay as they are.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="btn-outline"
              onClick={() => void handleReconnect()}
              disabled={reconnecting}
            >
              <RefreshIcon size={18} />
              {reconnecting ? 'Opening Meta…' : 'Reconnect Meta'}
            </button>
            {pages === null && (
              <button
                type="button"
                className="link-button"
                onClick={() => void handleChangePage()}
                disabled={loadingPages}
              >
                {loadingPages ? 'Loading Pages…' : 'Choose a different Page'}
              </button>
            )}
          </div>
          {pages !== null && (
            <div className="field">
              <label htmlFor="meta-settings-page">Page</label>
              <select
                id="meta-settings-page"
                value={selectedPageId}
                onChange={(event) => setSelectedPageId(event.target.value)}
              >
                <option value="">Select a Page</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                    {page.id === connection.pageId ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Choosing a different Page clears an Instagram account ID you entered by hand.
              </p>
              <button
                type="button"
                onClick={() => void handleSavePage()}
                disabled={savingPage || selectedPageId === '' || selectedPageId === connection.pageId}
              >
                {savingPage ? 'Saving…' : 'Use this Page'}
              </button>
            </div>
          )}
        </div>
        <InstagramAccountForm
          businessId={businessId}
          connection={connection}
          onUpdated={setConnection}
          showCheckAgain
        />
      </details>
    </section>
  )
}
