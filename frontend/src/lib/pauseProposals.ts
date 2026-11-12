import type { Recommendation } from './api'

// Ad pauses the daily check suggested and the user has not decided yet.
export function pendingPauseProposals(recommendations: Recommendation[]): Recommendation[] {
  return recommendations.filter((rec) => rec.actionType === 'PAUSE_AD' && rec.status === 'PENDING')
}

// "Proposed pause (rule NO_RESULT): Ad 'X' spent ... Needs your approval." -> "Ad 'X' spent ..."
export function proposalReason(reasoning: string): string {
  return reasoning
    .replace(/^Proposed pause \(rule [A-Z_]+\):\s*/, '')
    .replace(/\s*Needs your approval\.$/, '')
}
