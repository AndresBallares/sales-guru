import { Link } from 'react-router-dom'

// Rendered on every page (wired in at App.tsx, outside <Routes> so it
// doesn't need repeating per route) — Meta's Platform Terms expect these
// three documents to be easy to find from anywhere in the app, not just
// linked from the signup form.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link to="/terms">Terms of Service</Link>
      <Link to="/privacy">Privacy Policy</Link>
      <Link to="/data-deletion">Data Deletion Policy</Link>
    </footer>
  )
}
