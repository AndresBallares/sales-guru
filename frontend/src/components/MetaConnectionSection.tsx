import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ApiError,
  connectMeta,
  disconnectMeta,
  finalizeMetaConnection,
  getMetaConnection,
  listMetaAdAccounts,
  listMetaPages,
  type MetaAdAccount,
  type MetaConnection,
  type MetaPage,
} from '../lib/api'

export function MetaConnectionSection({ businessId }: { businessId: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [connection, setConnection] = useState<MetaConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([])
  const [pages, setPages] = useState<MetaPage[]>([])
  const [selectedAdAccountId, setSelectedAdAccountId] = useState('')
  const [selectedPageId, setSelectedPageId] = useState('')
  const [finalizing, setFinalizing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setConnection(await getMetaConnection(businessId))
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setConnection(null)
        setError(null)
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load Meta connection.')
      }
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The OAuth callback redirects the browser back here with ?meta=connected
  // or ?meta=error. Captured once via the lazy useState initializer, not
  // read live from searchParams — the cleanup effect below strips it from
  // the URL right after mount, and a live read would make the banner
  // disappear the instant that happens instead of staying visible.
  const [metaStatus] = useState(() => searchParams.get('meta'))
  useEffect(() => {
    if (!metaStatus) {
      return
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('meta')
        return next
      },
      { replace: true },
    )
  }, [metaStatus, setSearchParams])

  const pending = connection !== null && (connection.adAccountId === null || connection.pageId === null)

  useEffect(() => {
    if (!pending) {
      return
    }
    listMetaAdAccounts(businessId).then(setAdAccounts).catch(() => undefined)
    listMetaPages(businessId).then(setPages).catch(() => undefined)
  }, [pending, businessId])

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      const { authorizationUrl } = await connectMeta(businessId)
      window.location.href = authorizationUrl
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the Meta connection.')
      setConnecting(false)
    }
  }

  async function handleFinalize() {
    setFinalizing(true)
    setError(null)
    try {
      const updated = await finalizeMetaConnection(businessId, {
        adAccountId: selectedAdAccountId,
        pageId: selectedPageId,
      })
      setConnection(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the Meta connection.')
    } finally {
      setFinalizing(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    setError(null)
    try {
      await disconnectMeta(businessId)
      setConnection(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect Meta Ads.')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <section>
      <h2>Meta Ads</h2>
      {metaStatus === 'connected' && <p>Meta account connected — choose an ad account and Page below.</p>}
      {metaStatus === 'error' && (
        <p className="form-error" role="alert">
          Could not connect to Meta. Please try again.
        </p>
      )}
      {loading && <p>Loading…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!loading && connection === null && (
        <>
          <p>Not connected yet.</p>
          <button type="button" onClick={handleConnect} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect Meta Ads'}
          </button>
        </>
      )}

      {!loading && pending && (
        <div>
          <p>Choose which ad account and Page to use for this business.</p>
          <div className="field">
            <label htmlFor="meta-ad-account">Ad account</label>
            <select
              id="meta-ad-account"
              value={selectedAdAccountId}
              onChange={(event) => setSelectedAdAccountId(event.target.value)}
            >
              <option value="">Select an ad account</option>
              {adAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="meta-page">Page</label>
            <select
              id="meta-page"
              value={selectedPageId}
              onChange={(event) => setSelectedPageId(event.target.value)}
            >
              <option value="">Select a Page</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleFinalize}
            disabled={finalizing || !selectedAdAccountId || !selectedPageId}
          >
            {finalizing ? 'Saving…' : 'Save connection'}
          </button>
        </div>
      )}

      {!loading && connection !== null && !pending && (
        <div>
          <p>
            Connected — ad account <strong>{connection.adAccountId}</strong>, Page{' '}
            <strong>{connection.pageId}</strong>.
          </p>
          <button type="button" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      )}
    </section>
  )
}
