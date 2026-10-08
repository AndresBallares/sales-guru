import type { ChangeEvent } from 'react'
import { BLACK_THUMBNAIL_TIP } from '../lib/media'

// Shown when the browser could only capture a black frame from a video (iPhone
// HDR/HEVC in Safari): explains why, gives the iPhone tip, and takes a
// thumbnail image from the user instead. Used by every place a video is added.
export function BlackFrameFallback({
  fileName,
  inputId,
  onThumbnail,
  onCancel,
}: {
  fileName: string
  inputId: string
  onThumbnail: (thumbnail: File) => void
  onCancel: () => void
}) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const thumbnail = event.target.files?.[0]
    event.target.value = ''
    if (thumbnail) onThumbnail(thumbnail)
  }

  return (
    <div className="media-fallback" role="alert">
      <p>
        <strong>We could only capture a black frame from &ldquo;{fileName}&rdquo;.</strong>{' '}
        {BLACK_THUMBNAIL_TIP}
      </p>
      <label htmlFor={inputId}>Upload a thumbnail image</label>
      <input id={inputId} type="file" accept="image/jpeg,image/png" onChange={handleChange} />
      <button type="button" onClick={onCancel}>
        Cancel this video
      </button>
    </div>
  )
}
