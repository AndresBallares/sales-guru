import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  approveCampaign,
  approveRecommendation,
  connectMeta,
  createAudience,
  createBusiness,
  createCampaign,
  createProduct,
  createRecommendation,
  disconnectMeta,
  finalizeMetaConnection,
  getBusiness,
  getMe,
  getMetaConnection,
  listAudiences,
  listBusinesses,
  listCampaigns,
  listMetaAdAccounts,
  listMetaPages,
  listMetrics,
  listProducts,
  listRecommendations,
  login,
  logout,
  publishCampaign,
  refreshMetrics,
  rejectRecommendation,
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
      name: null,
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

describe('approveCampaign', () => {
  it('returns the now-approved campaign', async () => {
    const campaign = {
      id: '1',
      name: null,
      objective: 'SALES' as const,
      status: 'APPROVED',
      productId: null,
      audienceId: null,
      metaCampaignId: null,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(campaign))
    vi.stubGlobal('fetch', fetchMock)

    await expect(approveCampaign('biz-1', 'camp-1')).resolves.toEqual(campaign)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/approve')
    expect(options?.method).toBe('POST')
  })
})

describe('publishCampaign', () => {
  it('returns the now-live campaign', async () => {
    const campaign = {
      id: '1',
      name: null,
      objective: 'SALES' as const,
      status: 'LIVE',
      productId: null,
      audienceId: null,
      metaCampaignId: 'meta_campaign_1',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(campaign))
    vi.stubGlobal('fetch', fetchMock)

    await expect(publishCampaign('biz-1', 'camp-1')).resolves.toEqual(campaign)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/publish')
    expect(options?.method).toBe('POST')
  })

  it('throws ApiError when publishing fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ detail: 'Approve this campaign before publishing' }, 400)),
    )

    await expect(publishCampaign('biz-1', 'camp-1')).rejects.toMatchObject({
      status: 400,
      message: 'Approve this campaign before publishing',
    })
  })
})

describe('connectMeta', () => {
  it('returns the authorization URL for a business', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ authorizationUrl: 'https://meta.example/oauth' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(connectMeta('biz-1')).resolves.toEqual({
      authorizationUrl: 'https://meta.example/oauth',
    })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/meta/connect')
  })
})

describe('getMetaConnection', () => {
  it('returns the connection for a business', async () => {
    const connection = {
      id: 'conn-1',
      businessId: 'biz-1',
      metaUserId: 'meta-user-1',
      adAccountId: null,
      pageId: null,
      tokenExpiresAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-08-08T00:00:00Z',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(connection))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMetaConnection('biz-1')).resolves.toEqual(connection)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/meta')
  })

  it('throws ApiError when no connection exists yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ detail: 'Meta connection not found' }, 404)),
    )

    await expect(getMetaConnection('biz-1')).rejects.toMatchObject({
      status: 404,
      message: 'Meta connection not found',
    })
  })
})

describe('listMetaAdAccounts', () => {
  it('returns the ad accounts for a business', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse([{ id: 'act_1', name: 'Acme Ads' }]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listMetaAdAccounts('biz-1')).resolves.toEqual([
      { id: 'act_1', name: 'Acme Ads' },
    ])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/meta/ad-accounts')
  })
})

describe('listMetaPages', () => {
  it('returns the Pages for a business', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse([{ id: 'page_1', name: 'Acme Jewelry' }]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listMetaPages('biz-1')).resolves.toEqual([
      { id: 'page_1', name: 'Acme Jewelry' },
    ])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/meta/pages')
  })
})

describe('finalizeMetaConnection', () => {
  it('sends the chosen ad account and Page, returns the updated connection', async () => {
    const connection = {
      id: 'conn-1',
      businessId: 'biz-1',
      metaUserId: 'meta-user-1',
      adAccountId: 'act_1',
      pageId: 'page_1',
      tokenExpiresAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-08-08T00:00:00Z',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(connection))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      finalizeMetaConnection('biz-1', { adAccountId: 'act_1', pageId: 'page_1' }),
    ).resolves.toEqual(connection)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/meta/finalize')
    expect(JSON.parse(options?.body as string)).toEqual({
      adAccountId: 'act_1',
      pageId: 'page_1',
    })
  })
})

describe('disconnectMeta', () => {
  it('sends a DELETE request for the business', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(disconnectMeta('biz-1')).resolves.toBeUndefined()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/meta')
    expect(options?.method).toBe('DELETE')
  })
})

describe('refreshMetrics', () => {
  it('returns the newly stored snapshot', async () => {
    const metric = {
      id: 'metric-1',
      campaignId: 'camp-1',
      impressions: 1000,
      clicks: 50,
      spend: 12.5,
      conversions: 3,
      fetchedAt: '2026-08-08T00:00:00Z',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(metric, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshMetrics('biz-1', 'camp-1')).resolves.toEqual(metric)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/metrics/refresh')
    expect(options?.method).toBe('POST')
  })

  it('throws ApiError when refreshing fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ detail: 'Publish this campaign before viewing results' }, 400)),
    )

    await expect(refreshMetrics('biz-1', 'camp-1')).rejects.toMatchObject({
      status: 400,
      message: 'Publish this campaign before viewing results',
    })
  })
})

describe('listMetrics', () => {
  it('returns the list of stored snapshots for a campaign', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listMetrics('biz-1', 'camp-1')).resolves.toEqual([])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/metrics')
  })
})

const FAKE_RECOMMENDATION = {
  id: 'rec-1',
  campaignId: 'camp-1',
  actionType: 'INCREASE_BUDGET',
  targetAdId: null,
  currentBudget: 25,
  suggestedBudget: 30,
  reasoning: 'CPA decreased 24% over the last 3 days.',
  confidence: 0.91,
  risk: 'MEDIUM',
  requiresApproval: true,
  status: 'PENDING',
  createdAt: '2026-08-08T00:00:00Z',
}

describe('createRecommendation', () => {
  it('returns the newly generated recommendation', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(FAKE_RECOMMENDATION, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createRecommendation('biz-1', 'camp-1')).resolves.toEqual(
      FAKE_RECOMMENDATION,
    )
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/optimize')
    expect(options?.method).toBe('POST')
  })

  it('throws ApiError when there is not enough historical data yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ detail: 'Not enough historical data yet' }, 400)),
    )

    await expect(createRecommendation('biz-1', 'camp-1')).rejects.toMatchObject({
      status: 400,
      message: 'Not enough historical data yet',
    })
  })
})

describe('listRecommendations', () => {
  it('returns the list of recommendations for a campaign', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listRecommendations('biz-1', 'camp-1')).resolves.toEqual([])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/optimize')
  })
})

describe('approveRecommendation', () => {
  it('returns the now-applied recommendation', async () => {
    const applied = { ...FAKE_RECOMMENDATION, status: 'APPLIED' }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(applied))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      approveRecommendation('biz-1', 'camp-1', 'rec-1'),
    ).resolves.toEqual(applied)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/optimize/rec-1/approve')
    expect(options?.method).toBe('POST')
  })
})

describe('rejectRecommendation', () => {
  it('returns the now-rejected recommendation', async () => {
    const rejected = { ...FAKE_RECOMMENDATION, status: 'REJECTED' }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(rejected))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      rejectRecommendation('biz-1', 'camp-1', 'rec-1'),
    ).resolves.toEqual(rejected)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/optimize/rec-1/reject')
    expect(options?.method).toBe('POST')
  })
})
