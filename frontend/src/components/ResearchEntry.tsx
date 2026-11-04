import { useEffect, useState } from 'react'
import { listResearchRuns, type ResearchRun } from '../lib/api'
import { depthLabel, modelLabel, statusLabel } from '../lib/research'

// The "Research avatars" button and the list of past runs, on the Avatars tab. Hidden
// while the feature is off (every research route answers 404) or cannot be reached.
export function ResearchEntry({
  businessId,
  refreshKey,
  onOpen,
}: {
  businessId: string
  // Changes when the page comes back from a research view, so the list reloads.
  refreshKey: number
  // 'new' for the start screen, or a run id.
  onOpen: (view: string) => void
}) {
  const [runs, setRuns] = useState<ResearchRun[] | null>(null)

  useEffect(() => {
    let cancelled = false
    listResearchRuns(businessId)
      .then((list) => {
        if (!cancelled) setRuns(list)
      })
      .catch(() => {
        if (!cancelled) setRuns(null)
      })
    return () => {
      cancelled = true
    }
  }, [businessId, refreshKey])

  if (runs === null) return null
  const working = runs.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING')

  return (
    <section className="research-entry" aria-labelledby="research-entry-heading">
      <h3 id="research-entry-heading">Research new avatars</h3>
      <p className="field-hint">
        Let the AI research your market and draft buyer avatars for you to review.
      </p>
      {working && (
        <p>
          A research run is in progress.{' '}
          <button type="button" className="btn-outline" onClick={() => onOpen(working.id)}>
            View progress
          </button>
        </p>
      )}
      <button type="button" className="btn-outline btn-gold" onClick={() => onOpen('new')}>
        Research avatars
      </button>
      {runs.length > 0 && (
        <table className="research-runs">
          <caption>Past research runs</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Status</th>
              <th scope="col">Avatars saved</th>
              <th scope="col">Depth</th>
              <th scope="col">Model</th>
              <th scope="col">Cost</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{new Date(run.createdAt).toLocaleDateString()}</td>
                <td>{statusLabel(run.status, run.savedAvatarIds.length)}</td>
                <td>{run.savedAvatarIds.length}</td>
                <td>{depthLabel(run.depth)}</td>
                <td>{modelLabel(run.model)}</td>
                <td>${run.costUsd.toFixed(2)}</td>
                <td>
                  <button type="button" className="btn-outline" onClick={() => onOpen(run.id)}>
                    Open <span className="visually-hidden">run from {new Date(run.createdAt).toLocaleDateString()}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
