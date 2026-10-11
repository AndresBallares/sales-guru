import { useState } from 'react'
import type { Business, Creative } from '../lib/api'

// The one place a selected ad's Facebook/Instagram-post look is defined —
// shared by AdPreviewPage (the dedicated ad page) and CampaignsSection
// (the compact "Selected ad" view on BusinessDetailPage) so the two never
// drift apart the way the old, CampaignsSection-only `.ad-preview` (a
// plain data card with no logo/page-name/Sponsored chrome at all) did.
function FeedPost({
  business,
  creative,
  ctaLabel,
}: {
  business?: Business | null
  creative: Creative
  ctaLabel: string
}) {
  return (
    <div className="social-post" aria-label="Ad preview">
      <div className="social-post-header">
        <div className="social-post-avatar" aria-hidden="true">
          {business?.logoUrl ? (
            <img src={business.logoUrl} alt="" />
          ) : (
            business?.name.slice(0, 1).toUpperCase()
          )}
        </div>
        <div>
          <p className="social-post-page-name">{business?.name}</p>
          <p className="social-post-sponsored">Sponsored</p>
        </div>
      </div>
      <p className="social-post-body">{creative.bodyText}</p>
      {creative.format === 'CAROUSEL' ? (
        <ul className="social-post-carousel">
          {creative.cards.map((card) => (
            <li className="social-post-carousel-card" key={card.id}>
              <div className="social-post-carousel-image-frame">
                <img
                  className="social-post-carousel-image"
                  src={card.imageUrl}
                  alt={card.headline}
                />
              </div>
              <div className="social-post-carousel-card-text">
                <p className="social-post-headline">{card.headline}</p>
                {card.description && (
                  <p className="social-post-description">{card.description}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : creative.format === 'SINGLE_VIDEO' ? (
        <>
          <VideoFrame imageUrl={creative.imageUrl} videoUrl={creative.videoUrl} alt={creative.headline} />
          <div className="social-post-link-card">
            <div className="social-post-link-card-text">
              <p className="social-post-headline">{creative.headline}</p>
              <p className="social-post-description">{creative.description}</p>
            </div>
            <span className="social-post-cta">{ctaLabel}</span>
          </div>
        </>
      ) : (
        <>
          {creative.imageUrl && (
            <div className="social-post-image-frame">
              <img
                className="social-post-image"
                src={creative.imageUrl}
                alt={creative.headline}
              />
            </div>
          )}
          <div className="social-post-link-card">
            <div className="social-post-link-card-text">
              <p className="social-post-headline">{creative.headline}</p>
              <p className="social-post-description">{creative.description}</p>
            </div>
            <span className="social-post-cta">{ctaLabel}</span>
          </div>
        </>
      )}
      <div className="social-post-actions" aria-hidden="true">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↗ Share</span>
      </div>
    </div>
  )
}

// A video: its thumbnail with a play button; clicking swaps in the real player
// (so nothing is downloaded until the user asks to watch).
function VideoFrame({
  imageUrl,
  videoUrl,
  alt,
}: {
  imageUrl: string | null | undefined
  videoUrl: string | null | undefined
  alt: string
}) {
  // Which video is playing, so showing a different one starts back on its thumbnail.
  const [playing, setPlaying] = useState<string | null>(null)
  const isPlaying = playing !== null && playing === videoUrl
  if (isPlaying) {
    return (
      <div className="social-post-image-frame">
        <video
          className="social-post-image"
          src={videoUrl ?? undefined}
          poster={imageUrl ?? undefined}
          controls
          autoPlay
          playsInline
        />
      </div>
    )
  }
  return (
    <div className="social-post-image-frame social-post-video-frame">
      {imageUrl && <img className="social-post-image" src={imageUrl} alt={alt} />}
      {videoUrl && (
        <button
          type="button"
          className="social-post-play"
          aria-label="Play video"
          onClick={() => setPlaying(videoUrl)}
        >
          <span aria-hidden="true">▶</span>
        </button>
      )}
    </div>
  )
}

// Where Meta's Stories UI covers a 9:16 asset: the profile/name bar on top and the
// reply/call-to-action bar below. Keep faces, text and the product out of these.
const STORY_SAFE_TOP_PERCENT = 14
const STORY_SAFE_BOTTOM_PERCENT = 20

// The story placement: the 9:16 asset full-screen, with the covered areas shaded.
function StoryPreview({ creative }: { creative: Creative }) {
  const isVideo = creative.format === 'SINGLE_VIDEO'
  return (
    <div className="story-preview">
      <div className="story-frame">
        {isVideo ? (
          <VideoFrame
            imageUrl={creative.storyImageUrl}
            videoUrl={creative.storyVideoUrl}
            alt="Stories & Reels preview"
          />
        ) : (
          creative.storyImageUrl && (
            <img
              className="story-media"
              src={creative.storyImageUrl}
              alt="Stories & Reels preview"
            />
          )
        )}
        <div
          className="story-safe story-safe-top"
          style={{ height: `${STORY_SAFE_TOP_PERCENT}%` }}
          aria-hidden="true"
        />
        <div
          className="story-safe story-safe-bottom"
          style={{ height: `${STORY_SAFE_BOTTOM_PERCENT}%` }}
          aria-hidden="true"
        />
      </div>
      <p className="field-hint">
        Shaded top {STORY_SAFE_TOP_PERCENT}% and bottom {STORY_SAFE_BOTTOM_PERCENT}%:{' '}
        <span>Covered by the Stories UI</span>
      </p>
    </div>
  )
}

// The square asset: shown for every placement the feed and story assets don't
// cover (right column, Marketplace, search, Messenger, Audience Network, ...).
function SquarePreview({ creative }: { creative: Creative }) {
  const isVideo = creative.format === 'SINGLE_VIDEO'
  return (
    <div className="square-preview">
      <div className="square-frame">
        {isVideo ? (
          <VideoFrame
            imageUrl={creative.squareImageUrl}
            videoUrl={creative.squareVideoUrl}
            alt="Square preview"
          />
        ) : (
          creative.squareImageUrl && (
            <img className="square-media" src={creative.squareImageUrl} alt="Square preview" />
          )
        )}
      </div>
      <p className="field-hint">
        Shown in the right column, Marketplace, search, Messenger, Audience Network and every
        other placement not named for the feed or Stories &amp; Reels.
      </p>
    </div>
  )
}

// The ad as it will look. An ad with a Stories & Reels asset gets a Feed / Story
// toggle showing each placement's own asset; every other ad is just the post.
export function SocialPostPreview(props: {
  business?: Business | null
  creative: Creative
  ctaLabel: string
}) {
  const [view, setView] = useState<'feed' | 'story' | 'square'>('feed')
  const isCarousel = props.creative.format === 'CAROUSEL'
  const views: { id: 'feed' | 'story' | 'square'; label: string }[] = [{ id: 'feed', label: 'Feed' }]
  if (props.creative.storyAssetId && !isCarousel) views.push({ id: 'story', label: 'Story' })
  if (props.creative.squareAssetId && !isCarousel) views.push({ id: 'square', label: 'Square' })
  if (views.length === 1) return <FeedPost {...props} />
  return (
    <div className="placement-preview">
      <div className="placement-toggle" role="group" aria-label="Placement">
        {views.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={view === option.id}
            onClick={() => setView(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {view === 'story' ? (
        <StoryPreview creative={props.creative} />
      ) : view === 'square' ? (
        <SquarePreview creative={props.creative} />
      ) : (
        <FeedPost {...props} />
      )}
    </div>
  )
}
