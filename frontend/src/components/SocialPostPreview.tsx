import type { Business, Creative } from '../lib/api'

// The one place a selected ad's Facebook/Instagram-post look is defined —
// shared by AdPreviewPage (the dedicated ad page) and CampaignsSection
// (the compact "Selected ad" view on BusinessDetailPage) so the two never
// drift apart the way the old, CampaignsSection-only `.ad-preview` (a
// plain data card with no logo/page-name/Sponsored chrome at all) did.
export function SocialPostPreview({
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
