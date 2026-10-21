import type { Business, Creative } from '../lib/api'
import { FeedMedia, VideoFrame } from './SocialPostPreview'

function Avatar({ business }: { business?: Business | null }) {
  return (
    <div className="ig-avatar" aria-hidden="true">
      {business?.logoUrl ? (
        <img src={business.logoUrl} alt="" />
      ) : (
        business?.name.slice(0, 1).toUpperCase()
      )}
    </div>
  )
}

// A simulation of an Instagram feed ad, built from the ad's own data: the account, the
// feed asset, the call-to-action bar with the headline, and the caption (primary text).
// The description is left out because the Instagram feed does not show one.
export function InstagramFeedPost({
  business,
  creative,
  ctaLabel,
}: {
  business?: Business | null
  creative: Creative
  ctaLabel: string
}) {
  return (
    <div className="ig-post" aria-label="Instagram feed ad preview">
      <div className="ig-post-header">
        <Avatar business={business} />
        <div className="ig-post-account">
          <p className="ig-post-name">{business?.name}</p>
          <p className="ig-post-sponsored">Sponsored</p>
        </div>
        <span className="ig-post-menu" aria-hidden="true">
          •••
        </span>
      </div>
      <FeedMedia creative={creative} />
      <div className="ig-post-cta-bar">
        <span className="ig-post-cta-headline">{creative.headline}</span>
        <span className="ig-post-cta-label">{ctaLabel} ›</span>
      </div>
      <div className="ig-post-icons" aria-hidden="true">
        <span>♡</span>
        <span>💬</span>
        <span>➤</span>
        <span className="ig-post-save">🔖</span>
      </div>
      <p className="ig-post-caption">
        <strong>{business?.name}</strong> {creative.bodyText}
      </p>
    </div>
  )
}

// A simulation of Instagram Stories or Reels: the 9:16 asset full-screen with the
// platform's own top bar, call-to-action and (Reels) side buttons over it. Always the
// dark interface, whatever theme Sales Guru is in.
export function InstagramVertical({
  business,
  creative,
  ctaLabel,
  variant,
}: {
  business?: Business | null
  creative: Creative
  ctaLabel: string
  variant: 'stories' | 'reels'
}) {
  const isVideo = creative.format === 'SINGLE_VIDEO'
  const label = variant === 'stories' ? 'Instagram Stories ad preview' : 'Instagram Reels ad preview'
  return (
    <div className={`ig-vertical ig-vertical-${variant}`} aria-label={label}>
      <div className="ig-vertical-media">
        {isVideo ? (
          <VideoFrame
            imageUrl={creative.storyImageUrl}
            videoUrl={creative.storyVideoUrl}
            alt="Stories & Reels asset"
          />
        ) : (
          creative.storyImageUrl && (
            <img src={creative.storyImageUrl} alt="Stories & Reels asset" />
          )
        )}
      </div>
      <div className="ig-vertical-top" aria-hidden="true">
        {variant === 'stories' && <span className="ig-vertical-progress" />}
        <div className="ig-vertical-account">
          <Avatar business={business} />
          <span className="ig-vertical-name">{business?.name}</span>
          <span className="ig-vertical-sponsored">Sponsored</span>
        </div>
      </div>
      {variant === 'reels' && (
        <div className="ig-vertical-side" aria-hidden="true">
          <span>♡</span>
          <span>💬</span>
          <span>➤</span>
        </div>
      )}
      <div className="ig-vertical-bottom">
        {variant === 'reels' && (
          <p className="ig-vertical-caption">
            <strong>{business?.name}</strong> {creative.bodyText}
          </p>
        )}
        <span className="ig-vertical-cta">{ctaLabel}</span>
      </div>
    </div>
  )
}
