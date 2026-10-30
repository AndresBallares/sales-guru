// What a campaign card on the campaigns overview shows: its status badge, one line
// of "what's next", an honest progress bar where there is one, and the single primary
// action. All of it is derived from state the app already has; nothing is invented.

export type BadgeTone = 'neutral' | 'info' | 'ready' | 'attention' | 'busy' | 'success' | 'danger'

// 'open' opens the campaign's detail view (the existing expanded card). 'resume'
// activates a campaign that was published paused; 'restore' brings an archived one back.
export type PrimaryKind = 'open' | 'resume' | 'restore'

export interface CardProgress {
  value: number
  max: number
  label: string
}

export interface CardModel {
  badge: { label: string; tone: BadgeTone }
  message: string | null
  progress: CardProgress | null
  primary: { kind: PrimaryKind; label: string }
}

export interface CardInput {
  // The campaign's status as the backend stores it.
  status: string
  // The label the options endpoint gives that status; used only for a status this
  // file does not know about.
  fallbackStatusLabel: string
  // A publish is running: this tab is waiting on it, or the server says so.
  isPublishing: boolean
  // This tab is waiting on a strategy or an ad batch. Not stored on the server, so it
  // is only ever true while the request is in flight.
  generating: 'strategy' | 'ads' | null
  // Paused with the "Published paused" reason, which the app can activate. Any other
  // pause can only be undone in Meta.
  isActivatable: boolean
  pausedReason: string | null
  // A creative test's chosen ads against the number it needs; null for other campaigns.
  adSelection: { selected: number; required: number } | null
  // A draft's setup steps; null once the campaign is past setup.
  setup: SetupProgress | null
}

export interface SetupProgress {
  done: number
  total: number
  // What the first missing step is called, or null when setup is complete.
  next: string | null
}

// The setup steps a draft campaign goes through, and whether each is done. The card
// and the setup checklist both read this, so they cannot disagree.
export function setupStepStatus(campaign: { productId: string | null; audienceId: string | null }) {
  return {
    objective: true,
    product: campaign.productId !== null,
    audience: campaign.audienceId !== null,
  }
}

export function draftSetupProgress(campaign: {
  productId: string | null
  audienceId: string | null
}): SetupProgress {
  const steps = setupStepStatus(campaign)
  const done = Object.values(steps).filter(Boolean).length
  const next = !steps.product
    ? 'Choose a product'
    : !steps.audience
      ? 'Attach an audience'
      : null
  return { done, total: Object.keys(steps).length, next }
}

export function creativeCountText(count: number | null, failed = false): string {
  if (failed) return 'Creatives unavailable'
  if (count === null) return 'Loading creatives…'
  if (count === 0) return 'No creatives yet'
  return count === 1 ? '1 creative' : `${count} creatives`
}

export function cardModel(input: CardInput): CardModel {
  const open = (label: string): CardModel['primary'] => ({ kind: 'open', label })

  if (input.status === 'ARCHIVED') {
    return {
      badge: { label: 'Archived', tone: 'neutral' },
      message: 'Paused on Meta and hidden from your list. Its results are kept.',
      progress: null,
      primary: { kind: 'restore', label: 'Restore campaign' },
    }
  }

  if (input.isPublishing && input.status !== 'LIVE') {
    return {
      badge: { label: 'Publishing…', tone: 'busy' },
      message: 'Sending this campaign to Meta.',
      progress: null,
      primary: open('View publishing status'),
    }
  }

  if (input.generating) {
    return {
      badge: { label: 'Generating…', tone: 'busy' },
      message:
        input.generating === 'strategy'
          ? 'Generating your strategy…'
          : 'Generating your ads…',
      progress: null,
      primary: open('View progress'),
    }
  }

  switch (input.status) {
    case 'DRAFT': {
      const setup = input.setup
      return {
        badge: { label: 'Draft', tone: 'neutral' },
        message: setup?.next ? `Next: ${setup.next}` : 'Setup is complete.',
        progress: setup
          ? {
              value: setup.done,
              max: setup.total,
              label: `${setup.done} of ${setup.total} setup steps done`,
            }
          : null,
        primary: open('Continue setup'),
      }
    }
    case 'READY':
      return {
        badge: { label: 'Ready for strategy', tone: 'info' },
        message: 'Setup is complete. Next: generate your strategy.',
        progress: null,
        primary: open('Continue setup'),
      }
    case 'STRATEGY_GENERATED':
      return {
        badge: { label: 'Strategy ready', tone: 'info' },
        message: 'Next: generate your ads.',
        progress: null,
        primary: open('Continue setup'),
      }
    case 'ADS_GENERATED': {
      const selection = input.adSelection
      return {
        badge: { label: 'Needs your review', tone: 'attention' },
        // With a count, the progress bar says how many; the message says what to do.
        message: selection ? 'Choose the ads to run.' : 'Choose the ad you want to run.',
        progress:
          selection && selection.required > 0
            ? {
                value: Math.min(selection.selected, selection.required),
                max: selection.required,
                label: `${selection.selected} of ${selection.required} ads chosen`,
              }
            : null,
        primary: open('Review campaign'),
      }
    }
    case 'PENDING_APPROVAL':
    case 'APPROVED':
      return {
        badge: { label: 'Ready to publish', tone: 'ready' },
        message: 'Review your ads, then approve to send them to Meta.',
        progress: null,
        primary: open('Review and publish'),
      }
    case 'LIVE':
      return {
        badge: { label: 'Active', tone: 'success' },
        message: null,
        progress: null,
        primary: open('View campaign'),
      }
    case 'PAUSED':
      return {
        badge: { label: 'Paused', tone: 'neutral' },
        message: input.isActivatable
          ? 'Published paused, so it is not spending yet.'
          : input.pausedReason
            ? `Paused: ${input.pausedReason}`
            : null,
        progress: null,
        primary: input.isActivatable
          ? { kind: 'resume', label: 'Resume campaign' }
          : open('View campaign'),
      }
    case 'FAILED':
      return {
        badge: { label: 'Failed', tone: 'danger' },
        message: 'Publishing did not go through. You can retry.',
        progress: null,
        primary: open('Retry publish'),
      }
    default:
      return {
        badge: { label: input.fallbackStatusLabel, tone: 'neutral' },
        message: null,
        progress: null,
        primary: open('View campaign'),
      }
  }
}
