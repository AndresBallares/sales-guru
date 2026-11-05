import type { ReactNode } from 'react'
import type { BadgeTone, CardProgress } from '../lib/campaignCard'
import { ActionsMenu, type MenuItem } from './ActionsMenu'
import { PackageIcon } from './icons'

export type CardMenuItem = MenuItem

export interface CampaignCardProps {
  title: string
  // The objective, shown under the name.
  subtitle: string | null
  thumbnailUrl: string | null
  thumbnailAlt: string
  // The campaign's stored status, kept on the element for tests and styling hooks.
  status: string
  badge: { label: string; tone: BadgeTone }
  creativeText: string
  // An event campaign's venue and dates; null for any other campaign.
  eventText: string | null
  message: string | null
  progress: CardProgress | null
  primary: { label: string; onClick: () => void; disabled?: boolean }
  menuItems: CardMenuItem[]
  // A confirmation or an error that belongs to this card.
  children?: ReactNode
}

// One campaign on the overview: enough to recognise it and know what to do next. The
// detailed editing stays in the campaign's own view, which the primary action opens.
export function CampaignCard({
  title,
  subtitle,
  thumbnailUrl,
  thumbnailAlt,
  status,
  badge,
  creativeText,
  eventText,
  message,
  progress,
  primary,
  menuItems,
  children,
}: CampaignCardProps) {
  return (
    <li className="campaign-tile" data-status={status}>
      <div className="campaign-tile-top">
        <div className="campaign-tile-media">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={thumbnailAlt} loading="lazy" />
          ) : (
            <span className="campaign-tile-placeholder" aria-hidden="true">
              <PackageIcon />
            </span>
          )}
        </div>
        <div className="campaign-tile-identity">
          <h3 className="campaign-tile-title" title={title}>
            {title}
          </h3>
          {subtitle && <p className="campaign-tile-subtitle">{subtitle}</p>}
          <span className="campaign-tile-badge" data-tone={badge.tone}>
            <span className="campaign-tile-badge-dot" aria-hidden="true" />
            {badge.label}
          </span>
        </div>
      </div>

      <p className="campaign-tile-meta">{creativeText}</p>
      {eventText && <p className="campaign-tile-meta">{eventText}</p>}
      {message && <p className="campaign-tile-message">{message}</p>}
      {progress && (
        <div className="campaign-tile-progress">
          <progress value={progress.value} max={progress.max} aria-label={progress.label} />
          <span className="campaign-tile-progress-label">{progress.label}</span>
        </div>
      )}
      {children}

      <div className="campaign-tile-footer">
        <button
          type="button"
          className="btn-outline btn-gold campaign-tile-primary"
          onClick={primary.onClick}
          disabled={primary.disabled}
        >
          {primary.label}
        </button>
        {menuItems.length > 0 && (
          <div className="campaign-tile-menu">
            <ActionsMenu label={title} items={menuItems} />
          </div>
        )}
      </div>
    </li>
  )
}
