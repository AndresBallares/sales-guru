import { useState } from 'react'
import { ApiError, uploadProductImage, type ProductImage } from './api'
import {
  ALLOWED_IMAGE_TYPES,
  ASPECT_RATIO_WARNING,
  dimensionTooSmall,
  readImageDimensions,
  TOO_SMALL_ERROR,
  validateImageFile,
  type ImageDimensions,
} from './imageValidation'
import {
  BlackThumbnailError,
  classifyAspect,
  isVideoFile,
  MAX_VIDEO_SECONDS,
  normalizeVideoFile,
  readVideoInfo,
  UNCLASSIFIED_VIDEO_WARNING,
  UNSUPPORTED_MEDIA_ERROR,
  validateVideoFile,
  VIDEO_TOO_LONG_ERROR,
  type AspectClass,
  type VideoInfo,
  type VideoMeta,
} from './media'

// Media picked before its product exists yet (create mode): no product id to
// upload against until the form is submitted, so it waits here, in the order
// the user wants (first = primary), and is uploaded sequentially afterwards.
export interface StagedMedia {
  id: string
  file: File
  previewUrl: string
  warning: string | null
  // A staged video carries the browser-captured thumbnail uploaded with it;
  // previewUrl is then that thumbnail's object URL.
  isVideo: boolean
  thumbnail?: File
  durationSeconds?: number
  aspectClass: AspectClass
}

export const VIDEO_ONLY_ERROR = 'Choose a video file (MP4, MOV or M4V) here.'

let stagedCounter = 0

interface Options {
  businessId: string
  // null: the product doesn't exist yet, so stage instead of uploading.
  productId: string | null
  // 'media' takes photos and videos; 'video' refuses photos.
  accept: 'media' | 'video'
  // Called with each saved item once it is on the product.
  onUploaded?: (image: ProductImage) => void | Promise<void>
  // Called with each item staged for a product that doesn't exist yet.
  onStaged?: (media: StagedMedia) => void
}

// The one place a product's photo or video gets validated and saved, shared by
// the product form and the ad editor's "Upload a new video" so the two can
// never drift: type and size limits, the 60-second cap, the browser-captured
// thumbnail with its black-frame retry, and the manual-thumbnail fallback.
export function useMediaIntake({ businessId, productId, accept, onUploaded, onStaged }: Options) {
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // A video whose frame the browser could only draw black: waiting on a
  // manually uploaded thumbnail (or for the user to cancel it).
  const [blackVideo, setBlackVideo] = useState<{ file: File; meta: VideoMeta } | null>(null)

  async function save(file: File, video: VideoInfo | null, dimensions?: ImageDimensions) {
    const width = video?.width ?? dimensions?.width ?? 0
    const height = video?.height ?? dimensions?.height ?? 0
    const aspectClass = classifyAspect(width, height)
    const warning =
      aspectClass !== 'UNCLASSIFIED'
        ? null
        : video
          ? UNCLASSIFIED_VIDEO_WARNING
          : ASPECT_RATIO_WARNING

    if (productId !== null) {
      setUploading(true)
      try {
        const image = await uploadProductImage(businessId, productId, file, video?.thumbnail)
        await onUploaded?.(image)
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : video
              ? 'Could not upload video.'
              : 'Could not upload image.',
        )
      } finally {
        setUploading(false)
      }
    } else {
      onStaged?.({
        id: `staged-${++stagedCounter}`,
        file,
        previewUrl: URL.createObjectURL(video?.thumbnail ?? file),
        warning,
        isVideo: video !== null,
        thumbnail: video?.thumbnail,
        durationSeconds: video?.durationSeconds,
        aspectClass,
      })
    }
  }

  async function processFiles(files: File[]) {
    if (files.length === 0) return
    setError(null)
    for (const picked of files) {
      const file = isVideoFile(picked) ? normalizeVideoFile(picked) : picked
      if (isVideoFile(file)) {
        const videoError = validateVideoFile(file)
        if (videoError) {
          setError(videoError)
          continue
        }
        let info
        try {
          info = await readVideoInfo(file)
        } catch (err) {
          if (err instanceof BlackThumbnailError) {
            // The browser decoded the size and length but could only draw black
            // (iPhone HDR/HEVC in Safari): keep the video and ask for a
            // thumbnail instead of failing the upload outright.
            if (err.meta.durationSeconds > MAX_VIDEO_SECONDS) {
              setError(VIDEO_TOO_LONG_ERROR)
            } else {
              setBlackVideo({ file, meta: err.meta })
            }
          } else {
            setError(err instanceof Error ? err.message : 'Could not read this video.')
          }
          continue
        }
        if (info.durationSeconds > MAX_VIDEO_SECONDS) {
          setError(VIDEO_TOO_LONG_ERROR)
          continue
        }
        await save(file, info)
        continue
      }

      if (accept === 'video') {
        setError(VIDEO_ONLY_ERROR)
        continue
      }
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        setError(UNSUPPORTED_MEDIA_ERROR)
        continue
      }
      const typeOrSizeError = validateImageFile(file)
      if (typeOrSizeError) {
        setError(typeOrSizeError)
        continue
      }
      let dimensions
      try {
        dimensions = await readImageDimensions(file)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read this image.')
        continue
      }
      if (dimensionTooSmall(dimensions)) {
        setError(TOO_SMALL_ERROR)
        continue
      }
      await save(file, null, dimensions)
    }
  }

  // The user's own thumbnail for a video the browser could only draw black.
  async function submitManualThumbnail(thumbnail: File) {
    if (!blackVideo) return
    const thumbnailError = validateImageFile(thumbnail)
    if (thumbnailError) {
      setError(thumbnailError)
      return
    }
    setError(null)
    const { file, meta } = blackVideo
    setBlackVideo(null)
    await save(file, { ...meta, thumbnail })
  }

  return {
    processFiles,
    submitManualThumbnail,
    cancelBlackVideo: () => setBlackVideo(null),
    blackVideo,
    uploading,
    error,
    setError,
  }
}
