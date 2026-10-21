import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ThemeToggle } from './ThemeToggle'

// The theme toggle above every page. The signed-in home page draws it in its own header,
// beside Log out, so it is left out here to avoid a second one.
export function GlobalTopbar() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  if (pathname === '/' && user) return null
  return (
    <div className="global-topbar">
      <ThemeToggle />
    </div>
  )
}
