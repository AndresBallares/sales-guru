import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, resetPassword } from '../lib/api'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) {
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await resetPassword(token, newPassword)
      navigate('/login')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <main className="auth-page">
        <h1>Reset your password</h1>
        <p className="form-error" role="alert">
          This reset link is missing its token — copy the full link from your email, or
          request a new one.
        </p>
        <p>
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <h1>Reset your password</h1>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <div className="password-field">
            <input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <button
              type="button"
              className="password-toggle"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Resetting…' : 'Reset password'}
        </button>
      </form>
      <p>
        <Link to="/login">Back to log in</Link>
      </p>
    </main>
  )
}
