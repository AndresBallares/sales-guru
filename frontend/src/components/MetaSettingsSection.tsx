import { useEffect, useState } from 'react'
import { getMetaConnection, type MetaConnection } from '../lib/api'
import { InstagramAccountForm } from './InstagramAccountForm'

// Meta connection settings, reachable once setup is complete: which Instagram
// account ads run as. Collapsed by default; renders nothing without a
// connection.
export function MetaSettingsSection({ businessId }: { businessId: string }) {
  const [connection, setConnection] = useState<MetaConnection | null>(null)

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

  if (connection === null || connection.pageId === null) return null
  return (
    <section aria-labelledby="meta-settings-heading">
      <details>
        <summary id="meta-settings-heading">Meta connection settings</summary>
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
