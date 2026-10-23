import type { CreativeAngle } from './api'

const AVATAR_LABELS: Record<string, string> = {
  self_purchaser: 'Self-purchaser',
  gift_buyer: 'Gift buyer',
}

const PILLAR_LABELS: Record<string, string> = {
  offer: 'Offer',
  mechanism: 'Mechanism',
  education: 'Education',
  emotion: 'Emotion',
}

// "everyday-wear" -> "Everyday wear"
function conceptLabel(concept: string): string {
  const spaced = concept.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// The name a creative test ad carries on Meta and in this app: "<Avatar> – <Concept>",
// then " – <Pillar>" when it has one. An angle stored before avatars existed has none,
// so it is just its concept.
export function angleLabel(angle: CreativeAngle): string {
  const concept = conceptLabel(angle.concept)
  if (!angle.avatar) return concept
  const label = `${AVATAR_LABELS[angle.avatar]} – ${concept}`
  return angle.pillar ? `${label} – ${PILLAR_LABELS[angle.pillar]}` : label
}
