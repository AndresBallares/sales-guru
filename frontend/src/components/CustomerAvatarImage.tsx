import { useState, type CSSProperties } from 'react'
import { monogram, portraitHue } from '../lib/avatarPortrait'

// The portrait at the top of an avatar card. With an image URL it shows the image (lazy, and
// the fallback if the image fails to load); without one it draws the avatar's initials on a
// colour taken from its name. Decorative: the card's heading already names the avatar.
export function CustomerAvatarImage({ name, src }: { name: string; src?: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && failedSrc !== src

  return (
    <div
      className="avatar-portrait"
      style={{ '--portrait-hue': portraitHue(name) } as CSSProperties}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : (
        <span className="avatar-portrait-initials" aria-hidden="true">
          {monogram(name)}
        </span>
      )}
    </div>
  )
}
