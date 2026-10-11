// A cheap "do these images show the same thing?" check for an ad's Feed, Stories
// and Square versions. It compares coarse colour histograms of the images, which
// stay close when one photo is cropped to another shape and far apart for photos
// of different pieces on different backgrounds. It is only a hint, so callers
// should word anything they show as "look like".

const BINS = 4
const SAMPLE_SIZE = 16

// Calibrated on VENZI's product photos: the same photo cropped for feed and
// story scores about 0.87; a feed/story pair against a photo of a different
// piece on a white background scores about 0.07; different shots of one piece
// land around 0.45-0.5. Below this the images clearly share little.
export const DIFFERENT_ITEMS_THRESHOLD = 0.25

export const DIFFERENT_ITEMS_NOTE =
  'These look like different products — most ads use the same item in every version.'

// A normalised BINS x BINS x BINS colour histogram of RGBA pixel data (transparent
// pixels count as white, as they would on a white page).
export function colorSignature(rgba: ArrayLike<number>): number[] {
  const histogram = Array.from({ length: BINS * BINS * BINS }, () => 0)
  let counted = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255
    const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]].map((channel) =>
      Math.round(channel * alpha + 255 * (1 - alpha)),
    )
    const bin =
      Math.min(BINS - 1, Math.floor((r * BINS) / 256)) * BINS * BINS +
      Math.min(BINS - 1, Math.floor((g * BINS) / 256)) * BINS +
      Math.min(BINS - 1, Math.floor((b * BINS) / 256))
    histogram[bin] += 1
    counted += 1
  }
  return counted === 0 ? histogram : histogram.map((count) => count / counted)
}

// 1 for identical colour make-up, 0 for nothing in common.
export function histogramSimilarity(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + Math.min(value, b[index] ?? 0), 0)
}

// True when any two of the images share little: there are at least two, and some
// pair scores under the threshold.
export function looksLikeDifferentItems(
  signatures: number[][],
  threshold = DIFFERENT_ITEMS_THRESHOLD,
): boolean {
  for (let i = 0; i < signatures.length; i += 1) {
    for (let j = i + 1; j < signatures.length; j += 1) {
      if (histogramSimilarity(signatures[i], signatures[j]) < threshold) return true
    }
  }
  return false
}

// Reads an image into a colour signature in the browser; null when it cannot be
// read (not loadable, blocked from the canvas, or no canvas), so a caller says
// nothing rather than guessing.
export function loadColorSignature(url: string): Promise<number[] | null> {
  return new Promise((resolve) => {
    try {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = SAMPLE_SIZE
          canvas.height = SAMPLE_SIZE
          const context = canvas.getContext('2d')
          if (!context) {
            resolve(null)
            return
          }
          context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
          resolve(colorSignature(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data))
        } catch {
          resolve(null)
        }
      }
      image.onerror = () => resolve(null)
      image.src = url
    } catch {
      resolve(null)
    }
  })
}
