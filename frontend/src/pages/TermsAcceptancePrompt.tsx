import { useState, type FormEvent } from 'react'
import { TermsAcceptanceCheckbox } from '../components/TermsAcceptanceCheckbox'
import { useAuth } from '../context/AuthContext'
import { ApiError } from '../lib/api'

// Shown once, full-page, in place of the app — never a dismissible modal —
// for an existing account whose User.termsAcceptedAt is null or whose
// termsVersion no longer matches TERMS_VERSION (app/core/terms.py). Wired
// in at ProtectedRoute, the single choke point every authenticated route
// already goes through, so no individual page needs its own check.
export function TermsAcceptancePrompt() {
  const { acceptTerms } = useAuth()
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!termsAccepted) {
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await acceptTerms()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <h1>Our terms have been updated</h1>
      <p>Please review and accept before continuing to use Sales Guru.</p>
      <form onSubmit={handleSubmit} noValidate>
        <TermsAcceptanceCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting || !termsAccepted}>
          {submitting ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </main>
  )
}
