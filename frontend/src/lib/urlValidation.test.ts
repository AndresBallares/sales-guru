import { describe, expect, it } from 'vitest'
import {
  isValidDestinationUrl,
  normalizeDestinationUrl,
  requiresDestinationUrl,
} from './urlValidation'

describe('normalizeDestinationUrl', () => {
  it('leaves a valid https URL untouched', () => {
    expect(normalizeDestinationUrl('https://acme.example/ring')).toBe(
      'https://acme.example/ring',
    )
  })

  it('prepends https:// to a schemeless value', () => {
    expect(normalizeDestinationUrl('acme.example/ring')).toBe('https://acme.example/ring')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeDestinationUrl('  acme.example  ')).toBe('https://acme.example')
  })
})

describe('isValidDestinationUrl', () => {
  it('accepts a valid https URL', () => {
    expect(isValidDestinationUrl('https://acme.example/ring')).toBe(true)
  })

  it('accepts a valid http URL', () => {
    expect(isValidDestinationUrl('http://acme.example/ring')).toBe(true)
  })

  it('accepts a schemeless value (normalized to https)', () => {
    expect(isValidDestinationUrl('acme.example/ring')).toBe(true)
  })

  it('accepts a value with surrounding whitespace', () => {
    expect(isValidDestinationUrl('  acme.example  ')).toBe(true)
  })

  it('rejects a javascript: scheme', () => {
    expect(isValidDestinationUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects an ftp: scheme', () => {
    expect(isValidDestinationUrl('ftp://acme.example/file')).toBe(false)
  })

  it('rejects a mailto: scheme', () => {
    expect(isValidDestinationUrl('mailto:hello@acme.example')).toBe(false)
  })

  it('rejects a data: scheme', () => {
    expect(isValidDestinationUrl('data:text/plain;base64,SGVsbG8=')).toBe(false)
  })

  it('rejects localhost', () => {
    expect(isValidDestinationUrl('http://localhost:8000')).toBe(false)
  })

  it('rejects localhost case-insensitively', () => {
    expect(isValidDestinationUrl('http://LOCALHOST')).toBe(false)
  })

  it('rejects a public bare IP', () => {
    expect(isValidDestinationUrl('http://8.8.8.8')).toBe(false)
  })

  it('rejects a private bare IP', () => {
    expect(isValidDestinationUrl('http://10.0.0.5')).toBe(false)
  })

  it('rejects an IPv6 loopback literal', () => {
    expect(isValidDestinationUrl('http://[::1]')).toBe(false)
  })

  it('rejects a hostname with no TLD', () => {
    expect(isValidDestinationUrl('http://intranet')).toBe(false)
  })

  it('rejects an over-length URL', () => {
    expect(isValidDestinationUrl(`https://acme.example/${'a'.repeat(2048)}`)).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidDestinationUrl('   ')).toBe(false)
  })

  it('rejects a value that fails URL parsing outright', () => {
    expect(isValidDestinationUrl('[')).toBe(false)
  })

  it('rejects a URL with no hostname at all', () => {
    expect(isValidDestinationUrl('https://')).toBe(false)
  })
})

describe('requiresDestinationUrl', () => {
  it('is true for SALES', () => {
    expect(requiresDestinationUrl('SALES')).toBe(true)
  })

  it('is true for TRAFFIC', () => {
    expect(requiresDestinationUrl('TRAFFIC')).toBe(true)
  })

  it('is false for LEADS, MESSAGES, and AWARENESS', () => {
    expect(requiresDestinationUrl('LEADS')).toBe(false)
    expect(requiresDestinationUrl('MESSAGES')).toBe(false)
    expect(requiresDestinationUrl('AWARENESS')).toBe(false)
  })
})
