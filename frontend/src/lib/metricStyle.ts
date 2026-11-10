import type { MetricKey } from './metricCopy'

// One place that says which icon and which colours each metric has, so the same metric looks
// the same on its card, in the funnel, in the chart legend and in the explanations. Light values
// are the dashboard's palette (every icon-on-circle pair is at least 3:1; see metricStyle.test.ts,
// which works the ratios out); dark values are lighter tints of the same hues on a translucent
// circle, for the dark theme. Colours group by meaning: blue is exposure and acquisition cost,
// purple is how people respond, green is money and the cart, amber is purchases and checkout.

export type MetricIconName =
  | 'eye'
  | 'mousePointer'
  | 'shoppingCart'
  | 'flag'
  | 'dollar'
  | 'barChartUp'
  | 'target'
  | 'percent'
  | 'users'
  | 'repeat'
  | 'gauge'
  | 'mousePointerClick'
  | 'activity'
  | 'receipt'
  | 'globe'
  | 'creditCard'
  | 'banknote'
  | 'circleDollar'
  | 'trendingUp'
  | 'lightbulb'

export interface Tone {
  fg: string
  bg: string
}

export interface MetricStyle {
  icon: MetricIconName
  light: Tone
  dark: Tone
}

// Beyond the metrics: the Performance Over Time heading and the "What this means" panel.
export type StyleKey = MetricKey | 'trend' | 'insight'
export type Theme = 'light' | 'dark'

// The card colours the icons sit on, for working out contrast (the dark card is the page
// background with the translucent surface laid over it).
export const CARD_LIGHT = '#FFFFFF'
export const CARD_DARK = '#16161A'

const BLUE = {
  light: { fg: '#2563EB', bg: '#E8F0FF' },
  dark: { fg: '#7EB2FF', bg: '#2B3548' },
}
const PURPLE = {
  light: { fg: '#7C3AED', bg: '#F0E9FF' },
  dark: { fg: '#B79BFF', bg: '#363148' },
}
const DEEP_PURPLE = {
  light: { fg: '#6D28D9', bg: '#F0E9FF' },
  dark: PURPLE.dark,
}
const GREEN = {
  light: { fg: '#047857', bg: '#E4F7ED' },
  dark: { fg: '#4ADE9E', bg: '#203E34' },
}
const AMBER = {
  light: { fg: '#B7791F', bg: '#FFF2D8' },
  dark: { fg: '#F3C25B', bg: '#423827' },
}
const INDIGO = {
  light: { fg: '#4F46E5', bg: '#EEF0FF' },
  dark: { fg: '#9AA5FF', bg: '#303348' },
}

export const METRIC_STYLE: Record<StyleKey, MetricStyle> = {
  // The eight with an assigned icon and colour.
  impressions: { icon: 'eye', ...BLUE },
  linkClicks: { icon: 'mousePointer', ...PURPLE },
  addToCart: { icon: 'shoppingCart', ...GREEN },
  purchases: { icon: 'flag', ...AMBER },
  spend: { icon: 'dollar', ...GREEN },
  roas: { icon: 'barChartUp', ...DEEP_PURPLE },
  cac: { icon: 'target', ...BLUE },
  addToCartRate: { icon: 'percent', ...PURPLE },
  // The rest of the cards, in the same families.
  reach: { icon: 'users', ...BLUE },
  frequency: { icon: 'repeat', ...BLUE },
  cpm: { icon: 'gauge', ...BLUE },
  clicks: { icon: 'mousePointerClick', ...PURPLE },
  ctr: { icon: 'activity', ...PURPLE },
  cpc: { icon: 'receipt', ...PURPLE },
  landingPageViews: { icon: 'globe', ...BLUE },
  initiatedCheckout: { icon: 'creditCard', ...AMBER },
  purchaseRevenue: { icon: 'banknote', ...GREEN },
  costPerAddToCart: { icon: 'circleDollar', ...GREEN },
  trend: { icon: 'trendingUp', ...INDIGO },
  insight: { icon: 'lightbulb', ...AMBER },
}

// The colour a metric's line, points and legend marker are drawn in. It is the icon's own colour
// (for purchases that is the darker amber, because #F59E0B is only 2.15:1 on a white card).
export function seriesColor(key: StyleKey, theme: Theme): string {
  return METRIC_STYLE[key][theme].fg
}
