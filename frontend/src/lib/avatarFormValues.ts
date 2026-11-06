import type { BuyerAvatar, ConceptPillar, PurchaseFor } from './api'
import { AVATAR_LIST_FIELDS, conceptNameOf, type AvatarListField } from './avatarFields'

// The values the avatar form holds while it is open: lists as one entry per line of text.
export interface ConceptRow {
  name: string
  pillar: ConceptPillar
  description: string
}

export interface AvatarFormValues {
  name: string
  who: string
  purchaseFor: PurchaseFor
  lists: Record<AvatarListField, string>
  concepts: ConceptRow[]
}

export function emptyAvatarForm(): AvatarFormValues {
  const lists = {} as Record<AvatarListField, string>
  for (const { key } of AVATAR_LIST_FIELDS) lists[key] = ''
  return { name: '', who: '', purchaseFor: 'self', lists, concepts: [] }
}

export function avatarToForm(avatar: BuyerAvatar): AvatarFormValues {
  const lists = {} as Record<AvatarListField, string>
  for (const { key } of AVATAR_LIST_FIELDS) lists[key] = avatar[key].join('\n')
  return {
    name: avatar.name,
    who: avatar.who,
    purchaseFor: avatar.purchaseFor,
    lists,
    concepts: avatar.concepts.map((c) => ({
      name: conceptNameOf(c.slug),
      pillar: c.pillar,
      description: c.description,
    })),
  }
}
