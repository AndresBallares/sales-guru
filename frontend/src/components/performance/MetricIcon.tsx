import type { CSSProperties } from 'react'
import { METRIC_STYLE, type StyleKey } from '../../lib/metricStyle'
import { Glyph } from './metricGlyphs'

// A metric's icon in its tinted circle. Always decorative: the metric's name sits beside it as
// text. Colours come from the one config (lib/metricStyle.ts) as custom properties for both
// themes, so the same metric looks the same wherever it appears.
const SIZES = {
  // On a metric card: 64px circle, 28px glyph.
  card: { box: 64, glyph: 28 },
  // Beside an explanation in "What this means".
  row: { box: 44, glyph: 22 },
  // Beside a section heading.
  heading: { box: 48, glyph: 26 },
  // On a funnel step, which is only a fifth of the width.
  funnel: { box: 40, glyph: 20 },
} as const

export type MetricIconSize = keyof typeof SIZES

export function MetricIcon({
  metric,
  size = 'card',
}: {
  metric: StyleKey
  size?: MetricIconSize
}) {
  const { icon, light, dark } = METRIC_STYLE[metric]
  const dims = SIZES[size]
  const style = {
    width: dims.box,
    height: dims.box,
    '--m-fg': light.fg,
    '--m-bg': light.bg,
    '--m-fg-dark': dark.fg,
    '--m-bg-dark': dark.bg,
  } as CSSProperties
  return (
    <span className="metric-icon" data-metric={metric} aria-hidden="true" style={style}>
      <Glyph name={icon} size={dims.glyph} />
    </span>
  )
}
