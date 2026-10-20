import { useNavigate } from 'react-router-dom'
import { ChevronLeftIcon } from './icons'

// A soft circular back button for the top-left of a page. It always goes to the
// page's parent screen (`to`) rather than history, so it never lands outside the app
// (for example after a Meta sign-in round-trip) and a deep link still has a way up.
export function BackButton({ to, label = 'Back' }: { to: string; label?: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" className="back-button" aria-label={label} onClick={() => navigate(to)}>
      <ChevronLeftIcon />
    </button>
  )
}
