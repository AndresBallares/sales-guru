import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/** Redirects to the dashboard if already authenticated (e.g. visiting /login while logged in). */
export function GuestRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return <p>Loading…</p>
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
