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

export const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v'])
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
export const MAX_VIDEO_SECONDS = 60
const THUMBNAIL_MAX_SIDE = 1280

export const UNSUPPORTED_MEDIA_ERROR =
  'Unsupported file type — use a JPG or PNG photo, or an MP4/MOV/M4V video'
export const VIDEO_TOO_LARGE_ERROR =
  `Video exceeds the ${MAX_VIDEO_BYTES / (1024 * 1024)}MB limit — keep ad videos ` +
  'under 30 seconds (or compress the file) so they stay small'
export const VIDEO_TOO_LONG_ERROR = `Videos can be at most ${MAX_VIDEO_SECONDS} seconds long`
export const UNREADABLE_VIDEO_ERROR =
  'Could not read this video — it may be corrupted, or not a real MP4/MOV'

export const UNCLASSIFIED_VIDEO_WARNING =
  "This video's shape isn't a standard ad shape (1:1 or 4:5 feed, 9:16 story, " +
  '1.91:1 landscape) — Meta may crop it unpredictably in some ad placements.'

export interface VideoMeta {
  width: number
  height: number
  durationSeconds: number
}

export interface VideoInfo extends VideoMeta {
  thumbnail: File
}

// Every frame we tried came back (near-)black: the browser decoded the video's
// size and length but cannot render its pictures (iPhone HDR/HEVC in Safari is
// the known case). Carries what was read so the caller can still offer a
// manually uploaded thumbnail instead.
export class BlackThumbnailError extends Error {
  readonly meta: VideoMeta

  constructor(meta: VideoMeta) {
    super(
      'The browser could only capture a black frame from this video (common with ' +
        'iPhone HDR/HEVC video).',
    )
    this.name = 'BlackThumbnailError'
    this.meta = meta
  }
}

export const BLACK_THUMBNAIL_TIP =
  'You can upload a thumbnail image yourself. To avoid this next time, set iPhone ' +
  'Settings > Camera > Formats to Most Compatible and turn off Record Video > HDR Video.'

// Mirrors app/services/thumbnail_brightness.py's NEAR_BLACK_MEAN_LUMINANCE: the
// server refuses a thumbnail below this too, so a black one never gets stored.
export const NEAR_BLACK_MEAN_LUMINANCE = 5

const SAMPLE_SIZE = 32
const MAX_CAPTURE_ATTEMPTS = 3


export function isVideoType(type: string): boolean {
  return ALLOWED_VIDEO_TYPES.has(type)
}

const EXTENSION_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4', // the same container; Meta only knows video/mp4
  mov: 'video/quicktime',
}

function extensionType(name: string): string | undefined {
  return EXTENSION_TYPES[name.split('.').pop()?.toLowerCase() ?? '']
}

// Some browsers report no type (or a generic one) for .m4v/.mov files, so fall
// back to the file extension.
export function isVideoFile(file: File): boolean {
  if (isVideoType(file.type)) return true
  const typeless = file.type === '' || file.type === 'application/octet-stream'
  return typeless && extensionType(file.name) !== undefined
}

// A typeless video is re-wrapped with its real type so the server accepts it.
export function normalizeVideoFile(file: File): File {
  if (isVideoType(file.type)) return file
  const type = extensionType(file.name)
  return type ? new File([file], file.name, { type }) : file
}

export const PHOTOS_ONLY_HINT =
  "Videos can be added in the product's photos. Video ads are coming later."

// Mirrors app/services/media_info.py's classify_aspect.
export function classifyAspect(width: number, height: number): AspectClass {
  if (width <= 0 || height <= 0) return 'UNCLASSIFIED'
  const ratio = width / height
  for (const [aspectClass, target] of ASPECT_TARGETS) {
    if (Math.abs(ratio / target - 1) <= ASPECT_TOLERANCE) return aspectClass
  }
  return 'UNCLASSIFIED'
}

// Mirrors app/services/media_info.py's is_square: exactly 1:1, within tolerance.
// FEED covers both 1:1 and 4:5, so an ad's Square slot needs this on top of the class.
export function isSquare(width?: number | null, height?: number | null): boolean {
  if (!width || !height) return false
  return Math.abs(width / height - 1) <= ASPECT_TOLERANCE
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


// Photos only: a video can't be an ad image, a carousel card or a primary photo.
export function onlyPhotos(media: ProductImage[]): ProductImage[] {
  return media.filter((item) => item.mediaType !== 'VIDEO')
}

// Where to grab frames, in order: about a second in (a quarter of the way for a
// very short clip), then 2s / halfway, then deeper. Never the first frame, which
// is often black or a fade-in, and never the very end. At most three distinct
// attempts.
export function captureTimes(duration: number): number[] {
  const first = duration >= 4 ? 1 : duration * 0.25
  const candidates = [first, Math.min(2, duration * 0.5), duration * 0.5, duration * 0.75]
  const times: number[] = []
  for (const candidate of candidates) {
    const time = Math.round(Math.min(Math.max(candidate, 0.05), Math.max(duration - 0.05, 0.05)) * 100) / 100
    if (time > 0 && times.every((kept) => Math.abs(kept - time) > 0.01)) times.push(time)
  }
  return times.slice(0, MAX_CAPTURE_ATTEMPTS)
}

// Mean luma (0-255) of an RGBA pixel buffer; an empty sample counts as black.
export function meanLuminance(rgba: ArrayLike<number>): number {
  const pixels = Math.floor(rgba.length / 4)
  if (pixels === 0) return 0
  let total = 0
  for (let i = 0; i < pixels * 4; i += 4) {
    total += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]
  }
  return total / pixels
}

export interface ReadVideoOptions {
  // How long to wait for the browser to present a frame before nudging it with
  // a brief play/pause, how long that nudge runs, and how long a seek may take.
  frameTimeoutMs?: number
  playSettleMs?: number
  seekTimeoutMs?: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function seek(video: HTMLVideoElement, time: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(UNREADABLE_VIDEO_ERROR)), timeoutMs)
    video.onseeked = () => {
      clearTimeout(timer)
      video.onseeked = null
      resolve()
    }
    video.currentTime = time
  })
}

// Registered before the seek so a frame presented straight away isn't missed;
// resolves true once the browser has presented a frame, false on timeout or when
// it can't report frames at all.
function armFrameCallback(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  if (typeof video.requestVideoFrameCallback !== 'function') return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    video.requestVideoFrameCallback(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

// Safari can report a seek complete before it has decoded the picture; a short
// muted play then pause forces a frame to be shown.
async function nudgeFrame(video: HTMLVideoElement, settleMs: number): Promise<void> {
  try {
    await video.play()
  } catch {
    return // autoplay refused: draw whatever is there
  }
  await delay(settleMs)
  video.pause()
}

function frameIsBlack(video: HTMLVideoElement, context: CanvasRenderingContext2D | null) {
  const sample = document.createElement('canvas')
  sample.width = SAMPLE_SIZE
  sample.height = SAMPLE_SIZE
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  if (!sampleContext || !context) return null
  sampleContext.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  try {
    const { data } = sampleContext.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    return meanLuminance(data) < NEAR_BLACK_MEAN_LUMINANCE
  } catch {
    return false // a tainted canvas can't be read; don't block on it
  }
}

function encodeJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
}

// Reads a video's displayed size and duration and captures a JPEG frame as its
// thumbnail. Each attempt seeks to a sample time, waits for a frame to actually
// be presented, draws it, and checks it isn't black; a black frame retries at a
// later time (up to three attempts), then throws BlackThumbnailError.
export async function readVideoInfo(
  file: File,
  { frameTimeoutMs = 800, playSettleMs = 150, seekTimeoutMs = 8000 }: ReadVideoOptions = {},
): Promise<VideoInfo> {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    await new Promise<void>((resolve, reject) => {
      video.onerror = () => reject(new Error(UNREADABLE_VIDEO_ERROR))
      video.onloadedmetadata = () => resolve()
      video.src = url
    })
    const meta: VideoMeta = {
      width: video.videoWidth,
      height: video.videoHeight,
      durationSeconds: video.duration,
    }
    if (!Number.isFinite(meta.durationSeconds) || meta.width <= 0 || meta.height <= 0) {
      throw new Error(UNREADABLE_VIDEO_ERROR)
    }

    const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(meta.width, meta.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(meta.width * scale)
    canvas.height = Math.round(meta.height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error(UNREADABLE_VIDEO_ERROR)

    for (const time of captureTimes(meta.durationSeconds)) {
      const framePresented = armFrameCallback(video, frameTimeoutMs)
      await seek(video, time, seekTimeoutMs)
      if (!(await framePresented)) await nudgeFrame(video, playSettleMs)
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      if (frameIsBlack(video, context)) continue
      const blob = await encodeJpeg(canvas)
      if (!blob) throw new Error(UNREADABLE_VIDEO_ERROR)
      return { ...meta, thumbnail: new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }) }
    }
    throw new BlackThumbnailError(meta)
  } finally {
    URL.revokeObjectURL(url)
  }
}
