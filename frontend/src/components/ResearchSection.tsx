import { useEffect, useState } from 'react'
import { listResearchRuns } from '../lib/api'
import { ResearchRunView } from './ResearchRunView'
import { ResearchStart } from './ResearchStart'

// The research views of the Avatars tab: the start screen ('new') or one run.
export function ResearchSection({
  businessId,
  view,
  onNavigate,
  onBack,
  onLibraryChanged,
  onOpenAvatar,
}: {
  businessId: string
  view: string
  onNavigate: (view: string) => void
  onBack: () => void
  onLibraryChanged: () => void
  onOpenAvatar: (id: string) => void
}) {
  const [activeRunId, setActiveRunId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (view !== 'new') return
    let cancelled = false
    listResearchRuns(businessId)
      .then((runs) => {
        if (cancelled) return
        const working = runs.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING')
        setActiveRunId(working?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setActiveRunId(null)
      })
    return () => {
      cancelled = true
    }
  }, [businessId, view])

  return (
    <section className="avatars-section research-section">
      {view === 'new' ? (
        activeRunId === undefined ? (
          <p>Loading…</p>
        ) : (
          <ResearchStart
            businessId={businessId}
            activeRunId={activeRunId}
            onStarted={(run) => onNavigate(run.id)}
            onBack={onBack}
            onViewRun={onNavigate}
          />
        )
      ) : (
        <ResearchRunView
          key={view}
          businessId={businessId}
          runId={view}
          onBack={onBack}
          onLibraryChanged={onLibraryChanged}
          onOpenAvatar={onOpenAvatar}
        />
      )}
    </section>
  )
}
