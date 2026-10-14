import { useId, useState, type ReactNode } from 'react'
import { CheckIcon, ChevronDownIcon } from './icons'
import type { Creative, CreativeStatus } from '../lib/api'

const STATUS_LABELS: Record<CreativeStatus, string> = {
  GENERATED: 'Generated',
  SELECTED: 'Selected',
  REJECTED: 'Not selected',
}

// A collapsed-by-default section: a full-width button that exposes its state, and a region
// that stays mounted while hidden (so anything inside, like an editor's state, is kept).
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const regionId = useId()
  return (
    <div className="creative-card-details">
      <button
        type="button"
        className="creative-card-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <ChevronDownIcon />
      </button>
      <div id={regionId} hidden={!open} className="creative-card-details-body">
        {children}
      </div>
    </div>
  )
}

// One generated creative as a card: the marketing message first (headline, primary text,
// CTA, description), the prompts and the editing controls each tucked into their own
// disclosure, and one primary action at the bottom. The copy is shown as generated.
export function CreativeCard({
  letter,
  creative,
  ctaLabel,
  action,
  children,
}: {
  letter: string
  creative: Creative
  ctaLabel: string
  // The card's primary action (a button), rendered at the bottom.
  action?: ReactNode
  // The editing controls: shown in their own "Edit creative" disclosure.
  children?: ReactNode
}) {
  const headlineId = useId()
  const hasDetails = Boolean(creative.imagePrompt || creative.videoPrompt)
  const selected = creative.status === 'SELECTED'

  return (
    <article
      className={selected ? 'creative-card creative-card-selected' : 'creative-card'}
      aria-labelledby={headlineId}
    >
      <header className="creative-card-header">
        <div className="creative-card-title">
          <p className="creative-card-letter">Creative {letter}</p>
          <p className="creative-card-status">
            {selected && <CheckIcon />}
            {STATUS_LABELS[creative.status] ?? creative.status}
          </p>
          {creative.format === 'SINGLE_VIDEO' && (
            <span className="media-badge media-badge-video">Video ad</span>
          )}
        </div>
        {creative.creativeAngle && <p className="creative-card-angle">{creative.creativeAngle}</p>}
      </header>

      {creative.imageUrl && (
        <img
          className="creative-card-media"
          src={creative.imageUrl}
          alt={`Creative ${letter}`}
          width={160}
          height={160}
        />
      )}

      <h5 id={headlineId} className="creative-card-headline">
        {creative.headline}
      </h5>
      <p className="creative-card-body">{creative.bodyText}</p>
      <p className="creative-card-cta">
        <span className="creative-card-label">Call to action</span>
        <span className="creative-card-badge">{ctaLabel}</span>
      </p>
      {creative.description && <p className="creative-card-description">{creative.description}</p>}

      {hasDetails && (
        <Disclosure label="Creative details">
          {creative.imagePrompt && (
            <div>
              <p className="creative-card-label">Image prompt</p>
              <p className="creative-card-prompt">{creative.imagePrompt}</p>
            </div>
          )}
          {creative.videoPrompt && (
            <div>
              <p className="creative-card-label">Video prompt</p>
              <p className="creative-card-prompt">{creative.videoPrompt}</p>
            </div>
          )}
        </Disclosure>
      )}

      {children && <Disclosure label="Edit creative">{children}</Disclosure>}
      {action && <div className="creative-card-action">{action}</div>}
    </article>
  )
}
