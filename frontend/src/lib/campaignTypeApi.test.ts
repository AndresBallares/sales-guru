import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStrategy, getCampaignTypes, offerRoundPauses } from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getCampaignTypes', () => {
  it('reads the dropdown for a campaign', async () => {
    const options = {
      recommended: 'CREATIVE_TEST',
      options: [
        {
          type: 'CREATIVE_TEST',
          label: 'Creative Test',
          description: '4 ads per round, up to 3 rounds, budget moves to the winners.',
          available: true,
          reason: null,
          warning: null,
        },
      ],
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(options))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCampaignTypes('biz-1', 'camp-1')).resolves.toEqual(options)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/campaign-types')
  })
})

describe('createStrategy with a campaign type', () => {
  it('sends the chosen type and test format', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: 's1' }))
    vi.stubGlobal('fetch', fetchMock)

    await createStrategy('biz-1', 'camp-1', undefined, 'DATA_DRIVEN', 'CAROUSEL')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/strategy')
    expect(JSON.parse(String(options?.body))).toEqual({
      campaignType: 'DATA_DRIVEN',
      testFormat: 'CAROUSEL',
    })
  })

  it('sends no body when nothing was chosen, so the recommendation is used', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: 's1' }))
    vi.stubGlobal('fetch', fetchMock)

    await createStrategy('biz-1', 'camp-1')

    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
  })
})

describe('offerRoundPauses', () => {
  it('asks for the pause proposals with a POST and returns them', async () => {
    const offers = [{ id: 'rec-1', actionType: 'PAUSE_AD', status: 'PENDING' }]
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(offers))
    vi.stubGlobal('fetch', fetchMock)

    await expect(offerRoundPauses('biz-1', 'camp-1')).resolves.toEqual(offers)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/businesses/biz-1/campaigns/camp-1/rounds/pause-offer')
    expect(options?.method).toBe('POST')
  })
})
