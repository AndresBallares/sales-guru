// Destination URL validation — mirrors backend/app/services/url_validation.py
// for inline feedback only. The backend is authoritative: its 422 message
// is what actually gets shown to the user on submit, this is just to catch
// obvious problems before that round-trip.
//
// CLAUDE.md: all URL validation goes through validate_destination_url on
// the backend; this file is its frontend mirror, not a second source of
// truth — never add a second, different set of rules here.

import type { Objective } from './api'

export const DESTINATION_URL_ERROR_MESSAGE =
  "Please enter a full web address, e.g. https://yourshop.com/ring"

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_URL_LENGTH = 2048

// Objectives whose CTA button has to send someone somewhere real — mirrors
// backend's _OBJECTIVES_REQUIRING_URL.
const OBJECTIVES_REQUIRING_URL = new Set<Objective>(['SALES', 'TRAFFIC'])

export function requiresDestinationUrl(objective: Objective): boolean {
  return OBJECTIVES_REQUIRING_URL.has(objective)
}

function isIpLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '')
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true
  }
  return host.includes(':')
}

// A value with no scheme at all (e.g. "myshop.com/ring") gets https://
// assumed; a value with any other scheme (mailto:, javascript:, ...) is
// left alone and rejected by isValidDestinationUrl's protocol check —
// mirrors the backend's urlparse(value).scheme check exactly.
export function normalizeDestinationUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return trimmed
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return `https://${trimmed}`
  }
  return trimmed
}

export function isValidDestinationUrl(raw: string): boolean {
  const value = normalizeDestinationUrl(raw)
  if (!value || value.length > MAX_URL_LENGTH) {
    return false
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return false
  }

  const hostname = parsed.hostname
  if (!hostname) {
    return false
  }
  if (hostname.toLowerCase() === 'localhost') {
    return false
  }
  if (isIpLiteral(hostname)) {
    return false
  }
  return hostname.includes('.')
}
