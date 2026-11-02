import type { AvatarState, Creative, DashboardAdRow } from './api'
import { conceptLabel } from './creativeAngle'

const PILLAR_LABELS: Record<string, string> = {
  offer: 'Offer',
  mechanism: 'Mechanism',
  education: 'Education',
  emotion: 'Emotion',
}

// What marks an avatar that is no longer in play: "archived" once deleted, "inactive"
// once deactivated. An active avatar (or none) has no marker.
export function avatarMarker(state: AvatarState | null | undefined): string | null {
  return state === 'archived' || state === 'inactive' ? state : null
}

// The line a creative card shows for its angle: the avatar's name, then the concept
// and the pillar ("The Promotion Ring Buyer – Ceramic inlay – Mechanism"). A creative
// written before avatars existed keeps the self-purchaser / gift-buyer label it always had.
export function creativeAngleText(creative: Creative): string {
  const avatar = creative.buyerAvatar
  if (!avatar) return creative.creativeAngle ?? ''
  return [
    avatar.name,
    creative.concept ? conceptLabel(creative.concept) : null,
    creative.pillar ? PILLAR_LABELS[creative.pillar] : null,
  ]
    .filter(Boolean)
    .join(' – ')
}

// The buyer an ad on the dashboard was written for: the avatar's name and the pillar,
// or null for an ad with no avatar.
export function adAvatarLine(ad: DashboardAdRow): string | null {
  if (!ad.avatarName) return null
  return ad.pillar ? `${ad.avatarName} – ${PILLAR_LABELS[ad.pillar]}` : ad.avatarName
}
