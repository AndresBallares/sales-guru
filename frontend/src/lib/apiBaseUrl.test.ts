import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The API address is read once when the module loads, so each case loads a fresh copy.
async function loadApi(viteApiUrl: string | undefined) {
  vi.resetModules()
  vi.unstubAllEnvs()
  if (viteApiUrl !== undefined) vi.stubEnv('VITE_API_URL', viteApiUrl)
  return import('./api')
}

describe('the API base address', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'u1', email: 'a@example.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('calls /api on the frontend’s own address when VITE_API_URL is /api, so the cookie is first-party', async () => {
    const { getMe } = await loadApi('/api')

    await getMe()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/me')
    // A relative URL is same-origin, and the browser still attaches the session cookie.
    expect(init?.credentials).toBe('include')
  })

  it('keeps the full backend address in development', async () => {
    const { getMe } = await loadApi(undefined)

    await getMe()

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/auth/me')
  })

  it('still uses an absolute address when one is configured', async () => {
    const { getMe } = await loadApi('https://api.example.com')

    await getMe()

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/auth/me')
  })
})
