import { ASPECT_CLASS_LABELS, formatDuration, type AspectClass } from '../lib/media'

// The small labels under a thumbnail: its ad shape (Feed / Story / Landscape /
// Unclassified), and a video's length.
export function MediaBadges({
  aspectClass,
  isVideo,
  durationSeconds,
}: {
  aspectClass?: AspectClass | null
  isVideo: boolean
  durationSeconds?: number | null
}) {
  return (
    <p className="media-badges">
      {isVideo && (
        <span className="media-badge media-badge-video">
          Video{durationSeconds != null ? ` ${formatDuration(durationSeconds)}` : ''}
        </span>
      )}
      {aspectClass && (
        <span className={`media-badge media-badge-${aspectClass.toLowerCase()}`}>
          {ASPECT_CLASS_LABELS[aspectClass]}
        </span>
      )}
    </p>
  )
}
