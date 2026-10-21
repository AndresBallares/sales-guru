import { useId, useState, type ReactNode } from 'react'
import type { Business, Creative } from '../lib/api'
import {
  PLATFORMS,
  assetUrlFor,
  findPlacement,
  hasAsset,
  placementsFor,
  type Placement,
  type PlacementId,
  type Platform,
} from '../lib/previewPlacements'
import {
  ChevronDownIcon,
  ChevronLeftSmallIcon,
  ChevronRightSmallIcon,
  FacebookIcon,
  ImageIcon,
  InstagramIcon,
} from './icons'
import { InstagramFeedPost, InstagramVertical } from './InstagramPreview'
import { FeedPost, SquarePreview, StoryPreview } from './SocialPostPreview'

// The simulated post for one creative in the chosen platform and placement. It is always
// drawn from that placement's own asset: if the ad has none, a notice says so rather than
// showing a different asset in its place.
function Simulation({
  business,
  creative,
  ctaLabel,
  platform,
  placement,
}: {
  business: Business | null
  creative: Creative
  ctaLabel: string
  platform: Platform
  placement: Placement
}) {
  const missing = !hasAsset(creative, placement.asset)
  // Nothing to draw for a Stories or Square placement without its asset, so say so. A Feed
  // post is still drawn (its text and account), with the notice above it.
  if (missing && placement.asset !== 'feed') {
    return (
      <output className="preview-missing">{placement.missingHint}</output>
    )
  }
  const notice = missing && (
    <output className="preview-missing">{placement.missingHint}</output>
  )
  if (platform === 'instagram') {
    return placement.id === 'feed' ? (
      <>
        {notice}
        <div className="platform-sim platform-sim-light">
          <InstagramFeedPost business={business} creative={creative} ctaLabel={ctaLabel} />
        </div>
      </>
    ) : (
      <div className="platform-sim platform-sim-dark">
        <InstagramVertical
          business={business}
          creative={creative}
          ctaLabel={ctaLabel}
          variant={placement.id === 'reels' ? 'reels' : 'stories'}
        />
      </div>
    )
  }
  if (placement.id === 'stories') {
    return (
      <div className="platform-sim platform-sim-dark">
        <StoryPreview creative={creative} />
      </div>
    )
  }
  if (placement.id === 'other') {
    return (
      <div className="platform-sim platform-sim-light">
        <SquarePreview creative={creative} />
      </div>
    )
  }
  return (
    <>
      {notice}
      <div className="platform-sim platform-sim-light">
        <FeedPost business={business} creative={creative} ctaLabel={ctaLabel} />
      </div>
    </>
  )
}

// The left column of the ad preview workspace: platform tabs, placement, the creative
// pager, the simulated post, the thumbnail strip and the creative details. It only moves
// the previewed creative; nothing here selects or changes an ad.
export function PreviewStage({
  business,
  creatives,
  index,
  onIndexChange,
  ctaLabels,
  platform,
  onPlatformChange,
  placementId,
  onPlacementChange,
}: {
  business: Business | null
  creatives: Creative[]
  index: number
  onIndexChange: (index: number) => void
  ctaLabels: Record<string, string>
  platform: Platform
  onPlatformChange: (platform: Platform) => void
  placementId: PlacementId
  onPlacementChange: (placement: PlacementId) => void
}) {
  const panelId = useId()
  const creative = creatives[index]
  const placements = placementsFor(platform)
  const placement = findPlacement(platform, placementId)
  const ctaLabel = ctaLabels[creative.cta] ?? creative.cta
  const total = creatives.length

  return (
    <section className="preview-stage" aria-label="Ad preview">
      <div className="platform-tabs" role="tablist" aria-label="Platform">
        {PLATFORMS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            id={`${panelId}-tab-${option.id}`}
            aria-selected={platform === option.id}
            aria-controls={panelId}
            tabIndex={platform === option.id ? 0 : -1}
            className="platform-tab"
            onClick={() => onPlatformChange(option.id)}
          >
            {option.id === 'facebook' ? <FacebookIcon /> : <InstagramIcon />}
            {option.label}
          </button>
        ))}
      </div>

      <div className="placement-bar">
        <fieldset className="placement-options">
          <legend className="visually-hidden">Placement</legend>
          {placements.map((option) => (
            <button
              key={option.id}
              type="button"
              className="placement-option"
              aria-pressed={placementId === option.id}
              onClick={() => onPlacementChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        {total > 1 && (
          <div className="creative-pager">
            <button
              type="button"
              className="pager-button"
              aria-label="Previous creative"
              disabled={index === 0}
              onClick={() => onIndexChange(index - 1)}
            >
              <ChevronLeftSmallIcon />
            </button>
            <span className="pager-position" aria-live="polite">
              {index + 1} of {total}
            </span>
            <button
              type="button"
              className="pager-button"
              aria-label="Next creative"
              disabled={index === total - 1}
              onClick={() => onIndexChange(index + 1)}
            >
              <ChevronRightSmallIcon />
            </button>
          </div>
        )}
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${panelId}-tab-${platform}`}
        className="preview-canvas"
      >
        <Simulation
          key={`${platform}-${placement.id}-${creative.id}`}
          business={business}
          creative={creative}
          ctaLabel={ctaLabel}
          platform={platform}
          placement={placement}
        />
        <p className="preview-disclaimer">
          A simulation built from this ad&apos;s own text and assets. Facebook and Instagram may
          crop, trim or lay it out differently.
        </p>
      </div>

      {total > 1 && (
        <ul className="creative-thumbs" aria-label="Creatives">
          {creatives.map((item, position) => (
            <li key={item.id}>
              <button
                type="button"
                className="creative-thumb"
                aria-label={`View creative ${position + 1}`}
                aria-current={position === index ? 'true' : undefined}
                onClick={() => onIndexChange(position)}
              >
                {assetUrlFor(item, 'feed') ? (
                  <img src={assetUrlFor(item, 'feed') ?? undefined} alt="" />
                ) : (
                  <span className="creative-thumb-empty" aria-hidden="true">
                    <ImageIcon />
                  </span>
                )}
                <span className="creative-thumb-number" aria-hidden="true">
                  {position + 1}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <CreativeDetails creative={creative} ctaLabel={ctaLabel} />
    </section>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="creative-details-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

// A native disclosure: collapsed to start, keyboard and screen-reader friendly, and always
// showing the creative being previewed because it is rendered from it.
function CreativeDetails({ creative, ctaLabel }: { creative: Creative; ctaLabel: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="creative-details"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        Creative details
        <span className="creative-details-chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </summary>
      {open && (
        <dl>
          <DetailRow label="Headline">{creative.headline}</DetailRow>
          <DetailRow label="Primary text">{creative.bodyText}</DetailRow>
          {creative.description && (
            <DetailRow label="Description">{creative.description}</DetailRow>
          )}
          <DetailRow label="Call to action">{ctaLabel}</DetailRow>
          {creative.creativeAngle && (
            <DetailRow label="Creative angle">{creative.creativeAngle}</DetailRow>
          )}
        </dl>
      )}
    </details>
  )
}
