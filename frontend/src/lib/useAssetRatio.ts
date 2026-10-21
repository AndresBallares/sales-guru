import { useEffect, useState } from 'react'
import { describeRatio } from './previewPlacements'

// The real shape of an image, as a label like "4:5", once the browser has loaded it; null
// until then (and in environments that never load images), so callers fall back to the
// placement's own nominal ratio.
export function useAssetRatio(url: string | null): string | null {
  const [measured, setMeasured] = useState<{ url: string; label: string } | null>(null)
  useEffect(() => {
    if (!url) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) {
        setMeasured({ url, label: describeRatio(image.naturalWidth, image.naturalHeight) })
      }
    }
    image.src = url
    return () => {
      cancelled = true
    }
  }, [url])
  return measured && measured.url === url && measured.label ? measured.label : null
}
