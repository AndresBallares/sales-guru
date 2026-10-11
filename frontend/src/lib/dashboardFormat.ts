// Display formatting for the campaign dashboard. A null (unavailable) value is
// always an em dash, never a zero.

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export const UNAVAILABLE = '—'

export function formatMoney(value: number | null): string {
  return value === null ? UNAVAILABLE : money.format(value)
}

export function formatInteger(value: number | null): string {
  return value === null ? UNAVAILABLE : integer.format(value)
}

// ROAS is a multiple of spend: 2.95x.
export function formatRatio(value: number | null): string {
  return value === null ? UNAVAILABLE : `${value.toFixed(2)}x`
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? UNAVAILABLE : `${value.toFixed(digits)}%`
}

export function formatAsOf(iso: string | null): string {
  if (iso === null) return UNAVAILABLE
  const date = new Date(iso)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
