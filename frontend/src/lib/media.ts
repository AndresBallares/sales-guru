// Product media (photos and short videos) helpers. Mirrors backend/app/schemas/
// product_image.py and app/services/media_info.py for inline feedback only —
// the backend is authoritative and its 400 message is what's shown if this
// ever drifts. Videos are measured here in the browser (a <video> element and
// a canvas) because the backend has no decoder: the captured frame is uploaded
// alongside the video as its thumbnail.

import type { ProductImage } from './api'

export type AspectClass = 'FEED' | 'STORY' | 'LANDSCAPE' | 'UNCLASSIFIED'

export const ASPECT_CLASS_LABELS: Record<AspectClass, string> = {
  FEED: 'Feed 1:1 / 4:5',
  STORY: 'Story 9:16',
  LANDSCAPE: 'Landscape 1.91:1',
  UNCLASSIFIED: 'Unclassified',
}

const ASPECT_TARGETS: [AspectClass, number][] = [
  ['FEED', 1],
  ['FEED', 4 / 5],
  ['STORY', 9 / 16],
  ['LANDSCAPE', 1.91],
]
const ASPECT_TOLERANCE = 0.03

export const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime'])
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
export const MAX_VIDEO_SECONDS = 60
const THUMBNAIL_MAX_SIDE = 1280

export const UNSUPPORTED_MEDIA_ERROR =
  'Unsupported file type — use a JPG or PNG photo, or an MP4/MOV video'
export const VIDEO_TOO_LARGE_ERROR =
  `Video exceeds the ${MAX_VIDEO_BYTES / (1024 * 1024)}MB limit — keep ad videos ` +
  'under 30 seconds (or compress the file) so they stay small'
export const VIDEO_TOO_LONG_ERROR = `Videos can be at most ${MAX_VIDEO_SECONDS} seconds long`
export const UNREADABLE_VIDEO_ERROR =
  'Could not read this video — it may be corrupted, or not a real MP4/MOV'

export const UNCLASSIFIED_VIDEO_WARNING =
  "This video's shape isn't a standard ad shape (1:1 or 4:5 feed, 9:16 story, " +
  '1.91:1 landscape) — Meta may crop it unpredictably in some ad placements.'

export interface VideoInfo {
  width: number
  height: number
  durationSeconds: number
  thumbnail: File
}

// Photos only: a video can't be an ad image, a carousel card or a primary photo.
export function onlyPhotos(media: ProductImage[]): ProductImage[] {
  return media.filter((item) => item.mediaType !== 'VIDEO')
}

export function isVideoType(type: string): boolean {
  return ALLOWED_VIDEO_TYPES.has(type)
}

// Mirrors app/services/media_info.py's classify_aspect.
export function classifyAspect(width: number, height: number): AspectClass {
  if (width <= 0 || height <= 0) return 'UNCLASSIFIED'
  const ratio = width / height
  for (const [aspectClass, target] of ASPECT_TARGETS) {
    if (Math.abs(ratio / target - 1) <= ASPECT_TOLERANCE) return aspectClass
  }
  return 'UNCLASSIFIED'
}

export function formatDuration(seconds: number): string {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function validateVideoFile(file: File): string | null {
  if (!ALLOWED_VIDEO_TYPES.has(file.type)) return UNSUPPORTED_MEDIA_ERROR
  if (file.size > MAX_VIDEO_BYTES) return VIDEO_TOO_LARGE_ERROR
  return null
}

// Reads a video's displayed size and duration and captures a JPEG frame (a
// second in, or the middle of a very short clip) as its thumbnail.
export function readVideoInfo(file: File): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const fail = () => {
      URL.revokeObjectURL(url)
      reject(new Error(UNREADABLE_VIDEO_ERROR))
    }
    video.onerror = fail
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration)) return fail()
      video.currentTime = Math.min(1, video.duration / 2)
    }
    video.onseeked = () => {
      const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      const context = canvas.getContext('2d')
      if (!context) return fail()
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (!blob) return fail()
          URL.revokeObjectURL(url)
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            durationSeconds: video.duration,
            thumbnail: new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }),
          })
        },
        'image/jpeg',
        0.85,
      )
    }
    video.src = url
  })
}
