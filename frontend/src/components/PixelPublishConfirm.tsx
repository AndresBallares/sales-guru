import { useId } from 'react'
import type { PixelHealthState } from '../lib/usePixelHealth'
import { PixelHealthNotice } from './PixelHealthNotice'

// Beside a publish button: the Pixel's health, and, when it is not receiving the store's
// events (or Meta says it is unavailable), a confirmation the owner must tick before
// publishing anyway. The screen disables its button while `pixel.blocked`.
export function PixelPublishConfirm({ pixel }: { pixel: PixelHealthState }) {
  const id = useId()
  return (
    <div className="pixel-publish-confirm">
      <PixelHealthNotice pixel={pixel} />
      {pixel.needsConfirm && (
        <label htmlFor={id} className="pixel-publish-confirm-label">
          <input
            id={id}
            type="checkbox"
            checked={pixel.confirmed}
            onChange={(event) => pixel.setConfirmed(event.target.checked)}
          />
          Publish anyway: I know this Pixel is not receiving my store’s events
        </label>
      )}
    </div>
  )
}
