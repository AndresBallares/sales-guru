import { useCallback, useEffect, useState } from 'react'
import { getPixelHealth, type PixelHealth } from './api'

// The statuses that stop a publish until the owner confirms: the Pixel is receiving no
// website events at all, or Meta says it can't be used. A missing Purchase event, a check
// that could not be made, and a check still in progress never block.
const BLOCKING = new Set<PixelHealth['status']>(['no_events', 'unavailable'])

export interface PixelHealthState {
  health: PixelHealth | null
  // True while a look is in progress, the first one or a "check again".
  loading: boolean
  checkAgain: () => void
  needsConfirm: boolean
  confirmed: boolean
  setConfirmed: (confirmed: boolean) => void
  // Publishing is held: the problem is real and has not been confirmed.
  blocked: boolean
}

// Asks the server for the business's Pixel health when the screen loads (and `enabled`) (the server looks at
// Meta on demand and keeps the answer a few minutes). If the check fails the page carries on
// as if there were no news: a broken check must never stop a business from publishing.
export function usePixelHealth(
  businessId: string | undefined,
  enabled = true,
): PixelHealthState {
  const [health, setHealth] = useState<PixelHealth | null>(null)
  const [loading, setLoading] = useState(businessId !== undefined && enabled)
  const [confirmed, setConfirmed] = useState(false)

  const load = useCallback(
    (refresh: boolean, isCurrent: () => boolean) => {
      if (businessId === undefined || !enabled) return
      setLoading(true)
      getPixelHealth(businessId, refresh)
        .then((result) => {
          if (!isCurrent()) return
          // A different finding needs its own confirmation.
          setHealth((previous) => {
            if (previous?.status !== result.status) setConfirmed(false)
            return result
          })
        })
        .catch(() => undefined)
        .finally(() => {
          if (isCurrent()) setLoading(false)
        })
    },
    [businessId, enabled],
  )

  useEffect(() => {
    let current = true
    load(false, () => current)
    return () => {
      current = false
    }
  }, [load])

  const checkAgain = useCallback(() => load(true, () => true), [load])
  const needsConfirm = health !== null && BLOCKING.has(health.status)
  return {
    health,
    loading,
    checkAgain,
    needsConfirm,
    confirmed,
    setConfirmed,
    blocked: needsConfirm && !confirmed,
  }
}
