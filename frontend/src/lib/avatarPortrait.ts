// What a card draws when an avatar has no portrait: the initials of its name on a colour
// taken from the name, so the same avatar always looks the same and neighbours differ.

const SKIPPED_WORDS = new Set(['the', 'a', 'an'])

// Up to two capital letters: the first letters of the first two words that carry meaning
// ("The Promotion Ring Buyer" gives "PR"). A name with nothing usable gives "?".
export function monogram(name: string): string {
  const words = name
    .split(/[\s-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word !== '')
  const meaningful = words.filter((word) => !SKIPPED_WORDS.has(word.toLowerCase()))
  const used = (meaningful.length > 0 ? meaningful : words).slice(0, 2)
  const letters = used.map((word) => Array.from(word)[0].toUpperCase()).join('')
  return letters === '' ? '?' : letters
}

// A hue from 0 to 359 that depends only on the name.
export function portraitHue(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360
  return hash
}
