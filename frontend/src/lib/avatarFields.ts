// The seven list fields of a buyer avatar, shared by the research import review and the
// avatar editor. Each is edited as one entry per line of text and split back into entries
// when saved (the same tradeoff as the proof points field).
export type AvatarListField =
  | 'primaryProblems'
  | 'unknownProblems'
  | 'mechanisms'
  | 'alternatives'
  | 'objections'
  | 'hooks'
  | 'creativeAngles'

export const AVATAR_LIST_FIELDS: { key: AvatarListField; label: string }[] = [
  { key: 'primaryProblems', label: 'Primary problems' },
  { key: 'unknownProblems', label: 'Unknown problems' },
  { key: 'mechanisms', label: 'Mechanisms' },
  { key: 'alternatives', label: 'Current alternatives' },
  { key: 'objections', label: 'Objections' },
  { key: 'hooks', label: 'Hooks' },
  { key: 'creativeAngles', label: 'Creative angles' },
]

export function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

// The most avatars one business can hold (the backend's limit).
export const MAX_BUYER_AVATARS = 12

// Ad concepts per avatar: a name, a pillar and a one-line description (the backend's limits).
export const MAX_CONCEPTS = 5
export const CONCEPT_PILLARS: { value: 'offer' | 'mechanism' | 'education' | 'emotion'; label: string }[] = [
  { value: 'offer', label: 'Offer' },
  { value: 'mechanism', label: 'Mechanism' },
  { value: 'education', label: 'Education' },
  { value: 'emotion', label: 'Emotion' },
]

// A stored slug as readable text for the name field: "last-minute-rescue" -> "last minute rescue".
export function conceptNameOf(slug: string): string {
  return slug.replace(/-/g, ' ')
}
