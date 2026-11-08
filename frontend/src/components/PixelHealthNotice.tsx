import { formatAsOf } from '../lib/dashboardFormat'
import type { PixelHealthState } from '../lib/usePixelHealth'

// What Sales Guru last found out about the Pixel it uses: whether it is receiving the
// store's events, when it last did, and when this was checked (the server's time, so an old
// answer can never pass for a current one). Nothing is shown until a Pixel is selected, and
// nothing if the check itself could not be made.
export function PixelHealthNotice({ pixel }: { pixel: PixelHealthState }) {
  const { health, loading, checkAgain } = pixel
  if (health === null || health.status === 'none_selected') return null

  const loud =
    health.status === 'no_events' ||
    health.status === 'unavailable' ||
    health.status === 'no_purchase'
  const checked = `Checked ${formatAsOf(health.checkedAt)}`
  return (
    <section
      className={`pixel-health pixel-health-${health.status}`}
      aria-label="Pixel health"
      role={loud ? 'alert' : undefined}
    >
      <p className="pixel-health-main">
        {health.status === 'ok' && (
          <>
            Pixel “{health.pixelName}” is receiving events.
            {health.lastFiredAt && <> Last event {formatAsOf(health.lastFiredAt)}.</>}
          </>
        )}
        {loud && (
          <>
            <strong>Check your Pixel:</strong> {health.warning}
          </>
        )}
        {health.status === 'unreadable' && health.warning}
      </p>
      <p className="pixel-health-meta">
        {checked}
        <button
          type="button"
          className="pixel-health-again"
          onClick={checkAgain}
          disabled={loading}
        >
          {loading ? 'Checking…' : 'Check again'}
        </button>
      </p>
    </section>
  )
}
