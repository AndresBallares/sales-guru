// Product photo validation — mirrors backend/app/schemas/product_image.py
// for inline feedback only. The backend is authoritative: its 400 message
// on upload is what actually gets shown to the user if this mirror ever
// drifts, this is just to catch obvious problems before that round-trip
// (and, unlike the backend, before the file is even sent over the wire).

import { classifyAspect } from './media'

export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MIN_IMAGE_DIMENSION_PX = 600

export const UNSUPPORTED_TYPE_ERROR = 'Unsupported image type — use JPG or PNG'
export const TOO_LARGE_ERROR = `Image exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)}MB limit`
export const TOO_SMALL_ERROR = `Image is smaller than the ${MIN_IMAGE_DIMENSION_PX}px minimum on its short side`
export const UNREADABLE_IMAGE_ERROR = 'Could not read this image — it may be corrupted'
export const ASPECT_RATIO_WARNING =
  "This photo's shape isn't a standard ad shape (1:1 or 4:5 feed, 9:16 story, " +
  '1.91:1 landscape) — Meta may crop it unpredictably in some ad placements.'

export interface ImageDimensions {
  width: number
  height: number
}

// Content-type and size can be checked synchronously, straight off the
// File object — no need to read any bytes for these.
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return UNSUPPORTED_TYPE_ERROR
  if (file.size > MAX_IMAGE_BYTES) return TOO_LARGE_ERROR
  return null
}

// Decodes just enough of the file (via the browser's own image decoder,
// not a hand-rolled parser like the backend's app/services/
// image_dimensions.py — this only ever runs client-side, so there's no
// dependency concern) to read its pixel dimensions.
export function readImageDimensions(file: File): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(UNREADABLE_IMAGE_ERROR))
    }
    image.src = url
  })
}

export function dimensionTooSmall({ width, height }: ImageDimensions): boolean {
  return Math.min(width, height) < MIN_IMAGE_DIMENSION_PX
}

// Non-blocking — mirrors app/schemas/product_image.py's unclassified_warning:
// only a shape that matches no standard ad shape is flagged.
export function aspectRatioWarning({ width, height }: ImageDimensions): string | null {
  return classifyAspect(width, height) === 'UNCLASSIFIED' ? ASPECT_RATIO_WARNING : null
}
