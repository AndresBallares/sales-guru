// Waiting for a background (video) publish. Uploading a video to Meta and
// waiting for it to process takes minutes, so the backend runs it as a job and
// the page polls its status instead of holding one long request open.

import { getPublishStatus, type PublishStatus } from './api'
import { formatDuration } from './media'

interface WaitOptions {
  intervalMs?: number
  // Injectable so tests don't actually wait.
  sleep?: (ms: number) => Promise<void>
  // Consecutive failed status checks before giving up (a brief network blip
  // shouldn't abandon a publish that is still running on the server).
  maxConsecutiveErrors?: number
}

// A background publish that failed (or that we lost track of): its message is
// meant for the user, unlike an arbitrary Error.
export class PublishJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublishJobError'
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Polls until the publish finishes. Resolves when it is done (or nothing is
// running); throws the job's own error message when it failed.
export async function waitForPublishJob(
  businessId: string,
  campaignId: string,
  onStatus: (status: PublishStatus) => void,
  { intervalMs = 2000, sleep = defaultSleep, maxConsecutiveErrors = 5 }: WaitOptions = {},
): Promise<void> {
  let errors = 0
  for (;;) {
    let status: PublishStatus
    try {
      status = await getPublishStatus(businessId, campaignId)
      errors = 0
    } catch {
      errors += 1
      if (errors >= maxConsecutiveErrors) {
        throw new PublishJobError(
          'Lost contact with the server while publishing. Refresh the page to see where it got to.',
        )
      }
      await sleep(intervalMs)
      continue
    }
    onStatus(status)
    if (status.state === 'FAILED') {
      throw new PublishJobError(status.error ?? 'Could not publish this ad.')
    }
    if (status.state !== 'PROCESSING') return
    await sleep(intervalMs)
  }
}

// "Processing video… 40% (1:15)": what the publish button says while it runs.
export function describePublishStatus(status: PublishStatus): string {
  const label = status.step ? `${status.step}…` : 'Publishing…'
  const percent = status.progress != null ? ` ${status.progress}%` : ''
  const time =
    status.elapsedSeconds != null && status.elapsedSeconds >= 1
      ? ` (${formatDuration(status.elapsedSeconds)})`
      : ''
  return `${label}${percent}${time}`
}
