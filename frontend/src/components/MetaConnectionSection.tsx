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
  listMetaPixels,
  setMetaPixel,
  skipMetaPixel,
  type MetaAdAccount,
  type MetaConnection,
  type MetaPage,
  type MetaPixel,
} from '../lib/api'

export function MetaConnectionSection({
  businessId,
  onSetupComplete,
}: {
  businessId: string
  onSetupComplete?: (complete: boolean) => void
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [connection, setConnection] = useState<MetaConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [skippingPixel, setSkippingPixel] = useState(false)

  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([])
  const [pages, setPages] = useState<MetaPage[]>([])
  const [selectedAdAccountId, setSelectedAdAccountId] = useState('')
  const [selectedPageId, setSelectedPageId] = useState('')
  const [finalizing, setFinalizing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const [pixels, setPixels] = useState<MetaPixel[]>([])
  const [selectedPixelId, setSelectedPixelId] = useState('')
  const [settingPixel, setSettingPixel] = useState(false)
  const [pixelError, setPixelError] = useState<string | null>(null)

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

  // Reported up so the parent can move on to the Campaigns step — either
  // once a Pixel is actually saved, or once the user explicitly skips it
  // (the Pixel is optional; see the copy below the picker). pixelSkipped
  // is persisted on the connection itself (app/api/meta.py's skip_pixel),
  // not local component state, so this survives a remount instead of
  // re-prompting every time (confirmed bug, 2026-09-09).
  const setupComplete =
    connection !== null && !pending && (connection.pixelId !== null || connection.pixelSkipped)
  useEffect(() => {
    onSetupComplete?.(setupComplete)
  }, [setupComplete, onSetupComplete])

  useEffect(() => {
    if (!pending) {
      return
    }
    listMetaAdAccounts(businessId).then(setAdAccounts).catch(() => undefined)
    listMetaPages(businessId).then(setPages).catch(() => undefined)
  }, [pending, businessId])

  // Pixels belong to the ad account, so this can only run once one's been
  // chosen (finalize done, no longer pending) — separate, optional
  // follow-up step, since not every objective needs one (PRD.md §5 step 8).
  useEffect(() => {
    if (pending || connection === null) {
      return
    }
    listMetaPixels(businessId).then(setPixels).catch(() => undefined)
  }, [pending, connection, businessId])

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

  async function handleSetPixel() {
    setSettingPixel(true)
    setPixelError(null)
    try {
      const updated = await setMetaPixel(businessId, selectedPixelId)
      setConnection(updated)
    } catch (err) {
      setPixelError(err instanceof ApiError ? err.message : 'Could not save the Pixel.')
    } finally {
      setSettingPixel(false)
    }
  }

  async function handleSkipPixel() {
    setSkippingPixel(true)
    setPixelError(null)
    try {
      const updated = await skipMetaPixel(businessId)
      setConnection(updated)
    } catch (err) {
      setPixelError(err instanceof ApiError ? err.message : 'Could not skip the Pixel step.')
    } finally {
      setSkippingPixel(false)
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
        <div className="meta-step">
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
        <div className="meta-step">
          <p>
            Connected — ad account <strong>{connection.adAccountId}</strong>, Page{' '}
            <strong>{connection.pageId}</strong>.
          </p>

          {connection.pixelId ? (
            <p>
              Pixel: <strong>{connection.pixelId}</strong>
            </p>
          ) : (
            <div>
              <p>
                Optional — only needed for Sales campaigns, to track conversions.
              </p>
              <div className="field">
                <label htmlFor="meta-pixel">Meta Pixel</label>
                <select
                  id="meta-pixel"
                  value={selectedPixelId}
                  onChange={(event) => setSelectedPixelId(event.target.value)}
                >
                  <option value="">Select a Pixel</option>
                  {pixels.map((pixel) => (
                    <option key={pixel.id} value={pixel.id}>
                      {pixel.name}
                    </option>
                  ))}
                </select>
              </div>
              {pixelError && (
                <p className="form-error" role="alert">
                  {pixelError}
                </p>
              )}
            </div>
          )}

          <div className="button-row">
            <button type="button" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
            {!connection.pixelId && (
              <>
                <button
                  type="button"
                  onClick={handleSetPixel}
                  disabled={settingPixel || !selectedPixelId}
                >
                  {settingPixel ? 'Saving…' : 'Save Pixel'}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={handleSkipPixel}
                  disabled={skippingPixel}
                >
                  {skippingPixel ? 'Skipping…' : 'Skip for now'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
