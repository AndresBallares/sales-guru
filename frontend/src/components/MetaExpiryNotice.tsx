import type { MetaConnection } from '../lib/api'
import { formatDay } from '../lib/dashboardFormat'
import { ReconnectMetaButton } from './ReconnectMetaButton'

function daysLeft(days: number | null): string {
  if (days === null || days < 1) return 'less than a day'
  return days === 1 ? '1 day' : `${days} days`
}

// A Meta sign-in lasts about 60 days and can only be renewed by signing in again, so
// the warning starts 14 days ahead (decided by the server, which sends expiryStatus) and
// stays until the connection is renewed. It is not dismissible: after the date, nothing
// can be read from or changed on Meta.
export function MetaExpiryNotice({
  businessId,
  connection,
}: {
  businessId: string
  connection: MetaConnection
}) {
  if (connection.expiryStatus === 'ok') return null
  const date = formatDay(connection.tokenExpiresAt)
  return (
    <div className="flow-callout meta-expiry" role="alert">
      <p>
        {connection.expiryStatus === 'expired' ? (
          <>
            <strong>Your Meta connection expired on {date}.</strong> Results can’t update until
            you reconnect.
          </>
        ) : (
          <>
            <strong>
              Your Meta connection expires in {daysLeft(connection.daysUntilExpiry)} ({date}).
            </strong>{' '}
            Reconnect to keep your ads reading and updating.
          </>
        )}
      </p>
      <ReconnectMetaButton businessId={businessId} />
    </div>
  )
}
