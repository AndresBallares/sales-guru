import type { PerformanceSync } from '../../lib/api'
import { formatAsOf } from '../../lib/dashboardFormat'

// When Sales Guru last stored Meta's numbers. The time is the backend's own
// timestamp, never the browser clock, and the wording never claims the data is
// live: it refreshes on a schedule and the page only reads what is stored.
export function SyncStatus({
  sync,
  onConnectMeta,
}: {
  sync: PerformanceSync
  onConnectMeta?: () => void
}) {
  const cadence = `Performance data automatically refreshes about every ${sync.intervalMinutes} minutes.`
  const synced = sync.lastSyncedAt ? formatAsOf(sync.lastSyncedAt) : null
  return (
    <output className={`perf-sync perf-sync-${sync.status}`} aria-label="Meta data sync">
      <p className="perf-sync-main">
        <span className="perf-sync-dot" aria-hidden="true" />
        {sync.status === 'ok' && <>Last synced: {synced}</>}
        {sync.status === 'stale' && (
          <>
            <strong>Data may be out of date.</strong> Last successful sync: {synced}
          </>
        )}
        {sync.status === 'waiting' && <>Waiting for the first sync</>}
        {sync.status === 'not_connected' && <>Meta isn’t connected</>}
      </p>
      {sync.status === 'not_connected' ? (
        onConnectMeta && (
          <button type="button" className="btn-outline btn-gold" onClick={onConnectMeta}>
            Connect Meta
          </button>
        )
      ) : (
        <p className="perf-sync-sub">{cadence}</p>
      )}
    </output>
  )
}
