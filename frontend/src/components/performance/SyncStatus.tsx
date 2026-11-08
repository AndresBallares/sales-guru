import type { PerformanceSync } from '../../lib/api'
import { formatAsOf } from '../../lib/dashboardFormat'
import { ReconnectMetaButton } from '../ReconnectMetaButton'

// When Sales Guru last stored Meta's numbers, and when it could not. The time is the
// backend's own timestamp, never the browser clock, and the wording never claims the
// data is live: it refreshes on a schedule and the page only reads what is stored.
// A failed refresh says why, in the owner's words, and offers to reconnect when the
// sign-in is the problem. A failed spend check is shown under a healthy sync.
export function SyncStatus({
  businessId,
  sync,
  onConnectMeta,
}: {
  businessId: string
  sync: PerformanceSync
  onConnectMeta?: () => void
}) {
  const cadence = `Performance data automatically refreshes about every ${sync.intervalMinutes} minutes.`
  const synced = sync.lastSyncedAt ? formatAsOf(sync.lastSyncedAt) : null
  const failure = sync.failure ?? null
  const needsReconnect = failure?.needsReconnect === true
  return (
    <output className={`perf-sync perf-sync-${sync.status}`} aria-label="Meta data sync">
      <p className="perf-sync-main">
        <span className="perf-sync-dot" aria-hidden="true" />
        <span>
          {sync.status === 'ok' && <>Last synced: {synced}</>}
          {sync.status === 'stale' && (
            <>
              <strong>Data may be out of date.</strong> Last successful sync: {synced}
            </>
          )}
          {sync.status === 'failed' && (
            <>
              <strong>The last refresh from Meta failed.</strong> {failure?.reason}
            </>
          )}
          {sync.status === 'waiting' && <>Waiting for the first sync</>}
          {sync.status === 'not_connected' && <>Meta isn’t connected</>}
        </span>
      </p>
      {sync.status === 'failed' && synced && (
        <p className="perf-sync-sub">Last successful sync: {synced}</p>
      )}
      {failure?.source === 'reconcile' && (
        <p className="perf-sync-sub perf-sync-warning">
          The spend check couldn’t run: {failure.reason}
        </p>
      )}
      {sync.status === 'not_connected' ? (
        onConnectMeta && (
          <button type="button" className="btn-outline btn-gold" onClick={onConnectMeta}>
            Connect Meta
          </button>
        )
      ) : (
        <>
          <p className="perf-sync-sub">
            {sync.status === 'failed'
              ? `Sales Guru tries again every ${sync.intervalMinutes} minutes.`
              : cadence}
          </p>
          {needsReconnect && <ReconnectMetaButton businessId={businessId} />}
        </>
      )}
    </output>
  )
}
