import type { Recommendation } from '../lib/api'
import { pendingPauseProposals, proposalReason } from '../lib/pauseProposals'

interface Props {
  recommendations: Recommendation[]
  // 'card' is the short badge on the overview; 'detail' is the banner in the campaign itself.
  variant?: 'card' | 'detail'
}

// Nothing is ever paused automatically, so a losing ad keeps spending until the user decides.
// This makes a waiting suggestion impossible to miss.
export function PauseReviewBadge({ recommendations, variant = 'card' }: Props) {
  const waiting = pendingPauseProposals(recommendations)
  if (waiting.length === 0) return null
  const count = `${waiting.length} ad${waiting.length === 1 ? '' : 's'} to review`
  if (variant === 'card') {
    return (
      <output aria-label="Ads to review" className="review-badge">
        ⚠ {count}: losing ads are still running
      </output>
    )
  }
  return (
    <output aria-label="Ads to review" className="review-banner">
      <strong>⚠ {count}</strong>
      <span> — these look like they are losing money. Pause it or keep it running below.</span>
      <ul>
        {waiting.map((rec) => (
          <li key={rec.id}>{proposalReason(rec.reasoning)}</li>
        ))}
      </ul>
    </output>
  )
}
