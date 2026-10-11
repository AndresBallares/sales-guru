// A campaign is published once it has a Meta campaign id, whatever its status is now
// (live, paused, archived, or a status an old bug reset it to). Its ads exist on Meta,
// so none of the controls that would replace or edit them are offered.
export const ADS_LOCKED_NOTE =
  'This campaign is already published. Create a new campaign to change its ads.'

export function isPublished(campaign: { metaCampaignId: string | null } | null): boolean {
  return campaign !== null && campaign.metaCampaignId !== null
}
