import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AvatarsSection } from './AvatarsSection'
import { ResearchEntry } from './ResearchEntry'
import { ResearchSection } from './ResearchSection'

// The Avatars tab: the library, plus the avatar research. Which research view is open
// (?research=new, or a run id) lives in the address, so a refresh or a shared link comes
// back to it; the tab itself stays in the #hash the page keeps.
export function AvatarsTab({ businessId }: { businessId: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  // Bumped when the library changed or a research view closed, so lists reload.
  const [revision, setRevision] = useState(0)
  const view = new URLSearchParams(location.search).get('research')
  // An avatar the owner followed a link to from a research run: shown and focused in the list.
  const focusAvatarId = new URLSearchParams(location.search).get('avatar')

  function open(next: string | null) {
    const params = new URLSearchParams(location.search)
    if (next === null) params.delete('research')
    else params.set('research', next)
    const search = params.toString()
    navigate({
      pathname: location.pathname,
      search: search ? `?${search}` : '',
      hash: location.hash,
    })
  }

  function openAvatar(id: string) {
    setRevision((n) => n + 1)
    navigate({ pathname: location.pathname, search: `?avatar=${encodeURIComponent(id)}`, hash: location.hash })
  }

  if (view !== null && view !== '') {
    return (
      <ResearchSection
        businessId={businessId}
        view={view}
        onNavigate={open}
        onBack={() => {
          setRevision((n) => n + 1)
          open(null)
        }}
        onLibraryChanged={() => setRevision((n) => n + 1)}
        onOpenAvatar={openAvatar}
      />
    )
  }

  return (
    <>
      <AvatarsSection key={revision} businessId={businessId} focusAvatarId={focusAvatarId} />
      <ResearchEntry businessId={businessId} refreshKey={revision} onOpen={open} />
    </>
  )
}
