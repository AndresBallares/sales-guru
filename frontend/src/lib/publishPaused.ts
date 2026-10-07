// The "Publish paused" choice, remembered per campaign for the browser session.
//
// The checkbox lives on two pages: the dashboard's campaign list and the
// dedicated ad page. Each used to keep its own React state, so a choice made on
// one was lost on the other, and anything that remounted a page put it back to
// "paused" (an uncheck silently turned into a paused publish). Both now read
// and write this one stored value. It defaults to paused (checked): nothing
// spends until the user says so. Storage failures (private windows, blocked
// site data) fall back to that default instead of throwing.

const key = (campaignId: string) => `publishPaused:${campaignId}`

export function getPublishPaused(campaignId: string): boolean {
  try {
    return window.sessionStorage.getItem(key(campaignId)) !== 'false'
  } catch {
    return true
  }
}

export function setPublishPaused(campaignId: string, paused: boolean): void {
  try {
    window.sessionStorage.setItem(key(campaignId), String(paused))
  } catch {
    // Not remembered; the checkbox still works for this page view.
  }
}

// After a successful publish: the next publish of this campaign (e.g. after a
// failure is fixed) starts from the safe default again.
export function clearPublishPaused(campaignId: string): void {
  try {
    window.sessionStorage.removeItem(key(campaignId))
  } catch {
    // Nothing to forget.
  }
}
