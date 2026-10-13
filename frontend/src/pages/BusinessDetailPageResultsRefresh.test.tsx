import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/api'
import { BusinessDetailPage } from './BusinessDetailPage'

// The page's job here is wiring: when the campaign list reports a change, the Results
// section is told to reload. The sections are stand-ins that report their data the way
// the real ones do on load (so the page reaches its completed view) and expose that wiring.
type CampaignsChange = (campaigns: api.Campaign[]) => void
const wiring = vi.hoisted(() => ({
  report: (() => {}) as (campaigns: unknown[]) => void,
  resultsKeys: [] as Array<number | undefined>,
}))

function campaign(id: string, status = 'LIVE'): api.Campaign {
  return {
    id,
    name: id,
    objective: 'SALES',
    status,
    productId: null,
    audienceId: null,
    metaCampaignId: `meta-${id}`,
    eventVenueKey: null,
    startDate: null,
    endDate: null,
    pausedReason: null,
    dailySpendFlag: null,
    needsDestinationUrl: false,
  }
}

vi.mock('../components/CampaignsSection', () => ({
  CampaignsSection: ({ onCampaignsChange }: { onCampaignsChange?: CampaignsChange }) => {
    // Like the real list, report the campaigns once loaded.
    useEffect(() => {
      onCampaignsChange?.([campaign('a'), campaign('b')])
      if (onCampaignsChange) wiring.report = onCampaignsChange as typeof wiring.report
    }, [onCampaignsChange])
    return <p>Campaign list</p>
  },
}))
vi.mock('../components/DashboardSection', () => ({
  DashboardSection: ({ refreshKey }: { refreshKey?: number }) => {
    wiring.resultsKeys.push(refreshKey)
    return <p>Results section</p>
  },
}))
vi.mock('../components/BrandProfileSection', () => ({
  BrandProfileSection: ({ onProfileChange }: { onProfileChange: (p: unknown) => void }) => {
    useEffect(() => onProfileChange({ id: 'bp' }), [onProfileChange])
    return null
  },
}))
vi.mock('../components/ProductsSection', () => ({
  ProductsSection: ({ onProductsChange }: { onProductsChange: (p: unknown[]) => void }) => {
    useEffect(() => onProductsChange([{ id: 'p' }]), [onProductsChange])
    return null
  },
}))
vi.mock('../components/AudiencesSection', () => ({
  AudiencesSection: ({ onAudiencesChange }: { onAudiencesChange: (a: unknown[]) => void }) => {
    useEffect(() => onAudiencesChange([{ id: 'a' }]), [onAudiencesChange])
    return null
  },
}))
vi.mock('../components/MetaConnectionSection', () => ({
  MetaConnectionSection: ({ onSetupComplete }: { onSetupComplete?: (done: boolean) => void }) => {
    useEffect(() => onSetupComplete?.(true), [onSetupComplete])
    return <p>Meta setup</p>
  },
}))
vi.mock('../components/MetaSettingsSection', () => ({ MetaSettingsSection: () => null }))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getBusiness: vi.fn<typeof actual.getBusiness>(),
    getOptions: vi.fn<typeof actual.getOptions>(),
    // The page's up-front onboarding check.
    getBrandProfile: vi.fn<typeof actual.getBrandProfile>(),
    getMetaConnection: vi.fn<typeof actual.getMetaConnection>(),
    listCampaigns: vi.fn<typeof actual.listCampaigns>(),
  }
})
const mockedApi = vi.mocked(api)

describe('BusinessDetailPage: Results refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    wiring.resultsKeys.length = 0
    mockedApi.getBusiness.mockResolvedValue({
      id: 'biz-1',
      name: 'Acme',
      website: null,
      industry: null,
    } as api.Business)
    mockedApi.getOptions.mockResolvedValue({ industries: [] } as never)
    // Brand saved, Meta fully set up, a campaign exists: straight to the completed view.
    mockedApi.getBrandProfile.mockResolvedValue({} as api.BrandProfile)
    mockedApi.getMetaConnection.mockResolvedValue({
      adAccountId: 'act_1',
      pageId: 'page_1',
      pixelId: 'pixel_1',
      pixelSkipped: false,
    } as api.MetaConnection)
    mockedApi.listCampaigns.mockResolvedValue([campaign('a')])
  })

  async function renderCompletedPage() {
    render(
      <MemoryRouter initialEntries={['/businesses/biz-1']}>
        <Routes>
          <Route path="/businesses/:businessId" element={<BusinessDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    // The completed-setup view: Results above the campaign list.
    await screen.findByText('Results section')
    await screen.findByText('Campaign list')
  }

  it('does not reload Results for the campaign list’s first report (the initial load)', async () => {
    await renderCompletedPage()

    expect(wiring.resultsKeys.every((key) => key === 0)).toBe(true)
  })

  it('reloads Results when a campaign is deleted', async () => {
    await renderCompletedPage()
    const before = wiring.resultsKeys.at(-1) ?? 0

    act(() => wiring.report([campaign('b')]))

    expect(wiring.resultsKeys.at(-1)).toBe(before + 1)
  })

  it('reloads Results when a campaign is archived (its status changes)', async () => {
    await renderCompletedPage()
    const before = wiring.resultsKeys.at(-1) ?? 0

    act(() => wiring.report([campaign('a', 'ARCHIVED'), campaign('b')]))

    expect(wiring.resultsKeys.at(-1)).toBe(before + 1)
  })

  it('reloads Results when a campaign is added', async () => {
    await renderCompletedPage()
    const before = wiring.resultsKeys.at(-1) ?? 0

    act(() => wiring.report([campaign('a'), campaign('b'), campaign('c')]))

    expect(wiring.resultsKeys.at(-1)).toBe(before + 1)
  })

  it('does not reload Results when the same campaigns are reported again', async () => {
    await renderCompletedPage()
    const before = wiring.resultsKeys.at(-1)

    act(() => wiring.report([campaign('a'), campaign('b')]))

    expect(wiring.resultsKeys.at(-1)).toBe(before)
  })
})
