import { usePixelHealth } from '../lib/usePixelHealth'
import { PixelHealthNotice } from './PixelHealthNotice'

// The Pixel health notice for a screen that only reports it (the dashboard).
export function PixelHealthPanel({ businessId }: { businessId: string }) {
  return <PixelHealthNotice pixel={usePixelHealth(businessId)} />
}
