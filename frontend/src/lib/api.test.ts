import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createAudience,
  createBusiness,
  createCampaign,
  createProduct,
  getBusiness,
  getMe,
  listAudiences,
  listBusinesses,
  listCampaigns,
  listProducts,
  login,
  logout,
  signup,
} from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('signup', () => {
  it('returns the created user on success', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: '1', email: 'a@b.com' }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const user = await signup('a@b.com', 'password123')

    expect(user).toEqual({ id: '1', email: 'a@b.com' })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/auth/signup')
    expect(options).toBeDefined()
    expect(options?.credentials).toBe('include')
    expect(JSON.parse(options?.body as string)).toEqual({
      email: 'a@b.com',
      password: 'password123',
    })
  })

  it('throws ApiError with the string detail on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ detail: 'Email already registered' }, 409)),
    )

    await expect(signup('a@b.com', 'password123')).rejects.toMatchObject({
      status: 409,
      message: 'Email already registered',
    })
  })

  it('joins array-shaped validation error details into one message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            detail: [
              { msg: 'value is not a valid email address' },
              { msg: 'String should have at least 8 characters' },
            ],
          },
          422,
        ),
      ),
    )

    await expect(signup('bad', 'short')).rejects.toMatchObject({
      status: 422,
      message: 'value is not a valid email address; String should have at least 8 characters',
    })
  })

  it('falls back to statusText when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('not json', { status: 500, statusText: 'Server Error' })),
    )

    await expect(signup('a@b.com', 'password123')).rejects.toMatchObject({
      status: 500,
      message: 'Server Error',
    })
  })

  it('falls back to statusText when the JSON body has no detail field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ unrelated: 'field' }, 500)),
    )

    await expect(signup('a@b.com', 'password123')).rejects.toMatchObject({
      status: 500,
    })
  })

  it('falls back to statusText when detail is neither a string nor an array', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ detail: 42 }, 500)))

    await expect(signup('a@b.com', 'password123')).rejects.toMatchObject({
      status: 500,
    })
  })
})

describe('login', () => {
  it('returns the authenticated user', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: '1', email: 'a@b.com' })))

    await expect(login('a@b.com', 'password123')).resolves.toEqual({ id: '1', email: 'a@b.com' })
  })
})

describe('logout', () => {
  it('handles a 204 No Content response', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(logout()).resolves.toBeUndefined()
  })
})

describe('getMe', () => {
  it('returns the current user', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: '1', email: 'a@b.com' })))

    await expect(getMe()).resolves.toEqual({ id: '1', email: 'a@b.com' })
  })

  it('throws ApiError when unauthenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ detail: 'Not authenticated' }, 401)),
    )

    await expect(getMe()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('createBusiness', () => {
  it('sends only the provided fields and returns the created business', async () => {
    const business = {
      id: '1',
      name: 'Acme',
      website: null,
      industry: null,
      location: null,
      description: null,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(business, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createBusiness({ name: 'Acme' })).resolves.toEqual(business)
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options?.body as string)).toEqual({ name: 'Acme' })
  })
})

describe('listBusinesses', () => {
  it('returns the list of businesses', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([])))

    await expect(listBusinesses()).resolves.toEqual([])
  })
})

describe('getBusiness', () => {
  it('fetches a single business by id', async () => {
    const business = {
      id: '1',
      name: 'Acme',
      website: null,
      industry: null,
      location: null,
      description: null,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(business))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getBusiness('1')).resolves.toEqual(business)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/1')
  })
})

describe('createProduct', () => {
  it('sends only the provided fields and returns the created product', async () => {
    const product = {
      id: '1',
      description: 'Widgets',
      price: null,
      margin: null,
      features: null,
      benefits: null,
      url: null,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(product, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createProduct('biz-1', { description: 'Widgets' })).resolves.toEqual(
      product,
    )
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/products')
    expect(JSON.parse(options?.body as string)).toEqual({ description: 'Widgets' })
  })
})

describe('listProducts', () => {
  it('returns the list of products for a business', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listProducts('biz-1')).resolves.toEqual([])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/products')
  })
})

describe('createAudience', () => {
  it('sends only the provided fields and returns the created audience', async () => {
    const audience = {
      id: '1',
      description: 'Busy parents',
      ageMin: null,
      ageMax: null,
      location: null,
      interests: null,
      problem: null,
      desire: null,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(audience, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAudience('biz-1', { description: 'Busy parents' }),
    ).resolves.toEqual(audience)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/audiences')
    expect(JSON.parse(options?.body as string)).toEqual({ description: 'Busy parents' })
  })
})

describe('listAudiences', () => {
  it('returns the list of audiences for a business', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAudiences('biz-1')).resolves.toEqual([])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/audiences')
  })
})

describe('createCampaign', () => {
  it('sends only the provided fields and returns the created campaign', async () => {
    const campaign = {
      id: '1',
      objective: 'SALES' as const,
      status: 'DRAFT',
      productId: null,
      audienceId: null,
      metaCampaignId: null,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(campaign, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createCampaign('biz-1', { objective: 'SALES' })).resolves.toEqual(
      campaign,
    )
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns')
    expect(JSON.parse(options?.body as string)).toEqual({ objective: 'SALES' })
  })
})

describe('listCampaigns', () => {
  it('returns the list of campaigns for a business', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listCampaigns('biz-1')).resolves.toEqual([])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns')
  })
})
