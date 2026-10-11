import { useEffect, useState } from 'react'
import type { Creative } from '../lib/api'
import {
  DIFFERENT_ITEMS_NOTE,
  loadColorSignature,
  looksLikeDifferentItems,
} from '../lib/imageSimilarity'

// A gentle hint under an ad's Feed, Stories and Square slots when their images
// look like different items (the usual mistake is a different product photo in
// one slot). Shows nothing for a single-asset ad, while the images are loading,
// or when they cannot be read.
export function DifferentItemsNote({
  creative,
  loadSignature = loadColorSignature,
}: {
  creative: Creative
  loadSignature?: (url: string) => Promise<number[] | null>
}) {
  const [differ, setDiffer] = useState(false)
  const { imageUrl, storyImageUrl, squareImageUrl } = creative

  useEffect(() => {
    let cancelled = false
    setDiffer(false)
    const urls = [imageUrl, storyImageUrl, squareImageUrl].filter(
      (url): url is string => typeof url === 'string' && url !== '',
    )
    if (urls.length < 2) return
    void Promise.all(urls.map((url) => loadSignature(url))).then((signatures) => {
      if (cancelled) return
      const readable = signatures.filter((signature): signature is number[] => signature !== null)
      setDiffer(readable.length >= 2 && looksLikeDifferentItems(readable))
    })
    return () => {
      cancelled = true
    }
  }, [imageUrl, storyImageUrl, squareImageUrl, loadSignature])

  if (!differ) return null
  return <p className="field-hint different-items-note">{DIFFERENT_ITEMS_NOTE}</p>
}
