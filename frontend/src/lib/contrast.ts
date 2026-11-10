// WCAG 2 contrast, so a colour pair's ratio is worked out, not assumed.

function toRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

// 1 (no contrast) to 21 (black on white).
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// `share` of `top` laid over `base` (0 to 1), as a hex colour: how a translucent tint looks on a card.
export function mixHex(top: string, base: string, share: number): string {
  const t = toRgb(top)
  const b = toRgb(base)
  return (
    '#' +
    t
      .map((v, i) => Math.round(share * v + (1 - share) * b[i]))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}
