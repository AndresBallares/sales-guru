import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { TermsAcceptancePrompt } from '../pages/TermsAcceptancePrompt'

export function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return <p>Loading…</p>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.needsTermsAcceptance) {
    return <TermsAcceptancePrompt />
  }

  return <Outlet />
}
