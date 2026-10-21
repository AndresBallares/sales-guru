import { useState, type ReactNode } from 'react'
import type { Creative } from '../lib/api'
import { assetUrlFor } from '../lib/previewPlacements'
import { CopyIcon, ImageIcon } from './icons'

// The right column of the ad preview workspace: what is being previewed, a summary of the
// ad's own content, and whatever editing sections the page passes in.
export function PreviewDetailsPanel({
  platformLabel,
  placementLabel,
  ratio,
  position,
  total,
  creative,
  ctaLabel,
  children,
}: {
  platformLabel: string
  placementLabel: string
  ratio: string
  position: number
  total: number
  creative: Creative
  ctaLabel: string
  children?: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const thumb = assetUrlFor(creative, 'feed')
  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText)

  async function copyText() {
    const text = [creative.headline, creative.bodyText, creative.description]
      .filter(Boolean)
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <aside className="preview-details" aria-label="Preview details">
      <section className="detail-group" aria-labelledby="preview-details-heading">
        <h2 id="preview-details-heading" className="detail-heading">
          Preview details
        </h2>
        <dl className="detail-list">
          <div>
            <dt>Platform</dt>
            <dd>{platformLabel}</dd>
          </div>
          <div>
            <dt>Placement</dt>
            <dd>{placementLabel}</dd>
          </div>
          <div>
            <dt>Aspect ratio</dt>
            <dd>{ratio}</dd>
          </div>
          <div>
            <dt>Creative</dt>
            <dd>
              {position} of {total}
            </dd>
          </div>
        </dl>
      </section>

      <section className="detail-group" aria-labelledby="ad-content-heading">
        <h2 id="ad-content-heading" className="detail-heading">
          Ad content
        </h2>
        <div className="ad-summary">
          <div className="ad-summary-thumb" aria-hidden="true">
            {thumb ? <img src={thumb} alt="" /> : <ImageIcon />}
          </div>
          <div className="ad-summary-text">
            <p className="ad-summary-headline">{creative.headline}</p>
            <p className="ad-summary-body">{creative.bodyText}</p>
            <p className="ad-summary-cta">
              <span className="creative-card-badge">{ctaLabel}</span>
            </p>
          </div>
        </div>
        {canCopy && (
          <button type="button" className="copy-text-button" onClick={() => void copyText()}>
            <CopyIcon />
            {copied ? 'Copied' : 'Copy ad text'}
          </button>
        )}
      </section>

      {children}
    </aside>
  )
}
