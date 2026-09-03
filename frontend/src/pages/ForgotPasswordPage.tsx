import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, forgotPassword } from '../lib/api'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Shown regardless of whether the email is actually registered — the
  // backend's own response is already this generic on purpose, but the
  // page holds a fixed copy of it rather than rendering the API's
  // response text directly, so a future change to the backend message
  // can't accidentally start leaking something more specific here.
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await forgotPassword(email)
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <main className="auth-page">
        <h1>Check your email</h1>
        <p>If that email is registered, we've sent a link to reset your password.</p>
        <p>
          <Link to="/login">Back to log in</Link>
        </p>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <h1>Forgot your password?</h1>
      <p>Enter your email and we'll send you a link to reset it.</p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p>
        <Link to="/login">Back to log in</Link>
      </p>
    </main>
  )
}
