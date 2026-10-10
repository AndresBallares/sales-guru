import type { DashboardConfidence } from '../lib/api'

// Shown directly on the card, never in a tooltip: a number resting on little
// data says so in plain words ("Based on 3 purchases — too early to judge"),
// and one with enough data says how much it rests on.
export function ConfidenceFlag({ confidence }: { confidence: DashboardConfidence }) {
  if (confidence.sufficient) {
    return (
      <p className="dash-basis">
        Based on {confidence.basis} {confidence.unit}
      </p>
    )
  }
  return (
    <p className="dash-flag">
      <span className="dash-flag-tag">Early data</span> {confidence.label}
    </p>
  )
}
