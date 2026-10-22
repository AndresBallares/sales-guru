import type { CreativeAngle } from './api'

const AVATAR_LABELS: Record<string, string> = {
  self_purchaser: 'Self-purchaser',
  gift_buyer: 'Gift buyer',
}

// "everyday-wear" -> "Everyday wear"
function conceptLabel(concept: string): string {
  const spaced = concept.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// The name a creative test ad carries on Meta and in this app: "<Avatar> – <Concept>".
// An angle stored before avatars existed has none, so it is just its concept.
export function angleLabel(angle: CreativeAngle): string {
  const concept = conceptLabel(angle.concept)
  return angle.avatar ? `${AVATAR_LABELS[angle.avatar]} – ${concept}` : concept
}
