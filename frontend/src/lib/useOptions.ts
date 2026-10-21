import { useCallback, useEffect, useState } from 'react'
import { ApiError, getOptions, type OptionsResponse } from './api'

// What to tell the user when the fixed option lists (industries, objectives, price positioning,
// event venues) could not be loaded. They come from an authenticated endpoint, so a browser that
// lost its session gets a 401 and, without this, a dropdown that opens with nothing in it.
export function describeOptionsError(err: unknown): string {
  if (err instanceof ApiError && err.status === 401) {
    return "You're not signed in in this browser, so this list couldn't load. Log in again, then try once more."
  }
  return "This list couldn't load. Check your connection and try again."
}

// Loads the option lists, and keeps hold of why they failed so a form can say so and offer a retry.
export function useOptions() {
  const [options, setOptions] = useState<OptionsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    getOptions()
      .then((loaded) => {
        if (cancelled) return
        setOptions(loaded)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setOptions(null)
        setError(describeOptionsError(err))
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])
  return { options, error, retry }
}
