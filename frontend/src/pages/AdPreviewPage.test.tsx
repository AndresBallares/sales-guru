import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdPreviewPage } from './AdPreviewPage'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getBusiness: vi.fn<typeof actual.getBusiness>(),
    getOptions: vi.fn<typeof actual.getOptions>(),
    listCampaigns: vi.fn<typeof actual.listCampaigns>(),
    listCreatives: vi.fn<typeof actual.listCreatives>(),
    listProductImages: vi.fn<typeof actual.listProductImages>(),
    uploadProductImage: vi.fn<typeof actual.uploadProductImage>(),
    selectCreative: vi.fn<typeof actual.selectCreative>(),
    approveCampaign: vi.fn<typeof actual.approveCampaign>(),
    publishCampaign: vi.fn<typeof actual.publishCampaign>(),
  }
})
const mockedApi = vi.mocked(api)

const business: api.Business = {
  id: 'biz-1',
  name: 'Acme Widgets',
  website: null,
  industry: null,
  location: null,
  logoUrl: null,
  description: null,
}

function makeCampaign(overrides: Partial<api.Campaign> = {}): api.Campaign {
  return {
    id: 'camp-1',
    name: 'first campaign',
    objective: 'SALES',
    status: 'PENDING_APPROVAL',
    productId: 'prod-1',
    audienceId: 'aud-1',
    metaCampaignId: null,
    eventVenueKey: null,
    startDate: null,
    endDate: null,
    pausedReason: null,
    dailySpendFlag: null,
    needsDestinationUrl: false,
    ...overrides,
  }
}

function makeCreative(overrides: Partial<api.Creative> = {}): api.Creative {
  return {
    id: 'creative-1',
    campaignId: 'camp-1',
    adId: null,
    headline: 'Handmade wallets, made to last',
    bodyText: 'Full-grain leather, hand-stitched.',
    description: 'Shop the collection today.',
    cta: 'SHOP_NOW',
    creativeAngle: null,
    imagePrompt: null,
    videoPrompt: null,
    imageUrl: null,
    status: 'SELECTED',
    createdAt: '2026-09-05T00:00:00Z',
    isStale: false,
    ...overrides,
  }
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/businesses/biz-1/campaigns/camp-1/ad']}>
      <Routes>
        <Route
          path="/businesses/:businessId/campaigns/:campaignId/ad"
          element={<AdPreviewPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.getBusiness.mockResolvedValue(business)
  mockedApi.getOptions.mockResolvedValue({
    industries: [],
    objectives: [],
    campaignStatuses: [],
    ctas: [
      { value: 'SHOP_NOW', label: 'Shop Now' },
      { value: 'LEARN_MORE', label: 'Learn More' },
      { value: 'SIGN_UP', label: 'Sign Up' },
      { value: 'SUBSCRIBE', label: 'Subscribe' },
      { value: 'CONTACT_US', label: 'Contact Us' },
      { value: 'MESSAGE_PAGE', label: 'Send Message' },
      { value: 'GET_OFFER', label: 'Get Offer' },
      { value: 'DOWNLOAD', label: 'Download' },
      { value: 'BOOK_NOW', label: 'Book Now' },
    ],
    actionTypes: [],
    eventVenues: [],
  })
  mockedApi.listCampaigns.mockResolvedValue([makeCampaign()])
  mockedApi.listCreatives.mockResolvedValue([makeCreative()])
})

describe('AdPreviewPage', () => {
  it('shows the selected ad as a social-post preview', async () => {
    renderPage()

    expect(await screen.findByText('Handmade wallets, made to last')).toBeInTheDocument()
    expect(screen.getByText('Full-grain leather, hand-stitched.')).toBeInTheDocument()
    expect(screen.getByText('Shop the collection today.')).toBeInTheDocument()
    expect(screen.getByText('Shop Now')).toBeInTheDocument()
    expect(screen.getByText('Acme Widgets')).toBeInTheDocument()
    expect(screen.getByText('Sponsored')).toBeInTheDocument()
  })

  it('shows a fallback message when no ad has been selected yet', async () => {
    mockedApi.listCreatives.mockResolvedValue([makeCreative({ status: 'GENERATED' })])

    renderPage()

    expect(
      await screen.findByText(/No ad selected for this campaign yet/),
    ).toBeInTheDocument()
  })

  it('shows an error if loading fails', async () => {
    mockedApi.getBusiness.mockRejectedValue(new api.ApiError(404, 'Business not found'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Business not found')
  })

  it('uploads an image and attaches it to the ad', async () => {
    mockedApi.uploadProductImage.mockResolvedValue({
      id: 'img-1',
      url: 'http://localhost:8000/product-images/img-1',
      createdAt: '2026-09-05T00:00:00Z',
    })
    mockedApi.selectCreative.mockResolvedValue(
      makeCreative({ imageUrl: 'http://localhost:8000/product-images/img-1' }),
    )
    const user = userEvent.setup()
    const file = new File(['fake'], 'wallet.jpg', { type: 'image/jpeg' })

    renderPage()
    await screen.findByText('Handmade wallets, made to last')
    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    await user.upload(screen.getByLabelText('Upload from computer'), file)

    await waitFor(() =>
      expect(mockedApi.uploadProductImage).toHaveBeenCalledWith('biz-1', 'prod-1', file),
    )
    await waitFor(() =>
      expect(mockedApi.selectCreative).toHaveBeenCalledWith(
        'biz-1',
        'camp-1',
        'creative-1',
        'img-1',
      ),
    )
    expect(await screen.findByRole('img', { name: 'Handmade wallets, made to last' })).toHaveAttribute(
      'src',
      'http://localhost:8000/product-images/img-1',
    )
  })

  it('shows an error if uploading fails', async () => {
    mockedApi.uploadProductImage.mockRejectedValue(
      new api.ApiError(400, 'Image exceeds the 5MB limit'),
    )
    const user = userEvent.setup()
    const file = new File(['fake'], 'wallet.jpg', { type: 'image/jpeg' })

    renderPage()
    await screen.findByText('Handmade wallets, made to last')
    await user.click(screen.getByRole('button', { name: 'Upload Image' }))
    await user.upload(screen.getByLabelText('Upload from computer'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('Image exceeds the 5MB limit')
  })

  it('lets the user choose an existing photo from the library', async () => {
    mockedApi.listCreatives.mockResolvedValue([
      makeCreative({ imageUrl: 'http://localhost:8000/product-images/old.jpg' }),
    ])
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-2', url: 'http://localhost:8000/product-images/img-2', createdAt: '2026-09-05T00:00:00Z' },
    ])
    mockedApi.selectCreative.mockResolvedValue(
      makeCreative({ imageUrl: 'http://localhost:8000/product-images/img-2' }),
    )
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Change image' }))
    await user.click(screen.getByRole('button', { name: 'Choose from library' }))
    await screen.findByRole('img', { name: 'Product option' })
    await user.click(screen.getByRole('img', { name: 'Product option' }))

    await waitFor(() =>
      expect(mockedApi.selectCreative).toHaveBeenCalledWith(
        'biz-1',
        'camp-1',
        'creative-1',
        'img-2',
      ),
    )
  })

  it('shows an error if the photo library fails to load', async () => {
    mockedApi.listCreatives.mockResolvedValue([
      makeCreative({ imageUrl: 'http://localhost:8000/product-images/old.jpg' }),
    ])
    mockedApi.listProductImages.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Change image' }))
    await user.click(screen.getByRole('button', { name: 'Choose from library' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load photo library.')
  })

  it('shows an error if attaching a library photo fails', async () => {
    mockedApi.listCreatives.mockResolvedValue([
      makeCreative({ imageUrl: 'http://localhost:8000/product-images/old.jpg' }),
    ])
    mockedApi.listProductImages.mockResolvedValue([
      { id: 'img-2', url: 'http://localhost:8000/product-images/img-2', createdAt: '2026-09-05T00:00:00Z' },
    ])
    mockedApi.selectCreative.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Change image' }))
    await user.click(screen.getByRole('button', { name: 'Choose from library' }))
    await user.click(await screen.findByRole('img', { name: 'Product option' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not attach image.')
  })

  it('approves and publishes a pending campaign', async () => {
    mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
    mockedApi.publishCampaign.mockResolvedValue(makeCampaign({ status: 'LIVE' }))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

    await waitFor(() => expect(mockedApi.approveCampaign).toHaveBeenCalledWith('biz-1', 'camp-1'))
    expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1')
  })

  it('retries publishing a failed campaign without re-approving', async () => {
    mockedApi.listCampaigns.mockResolvedValue([makeCampaign({ status: 'FAILED' })])
    mockedApi.publishCampaign.mockResolvedValue(makeCampaign({ status: 'LIVE' }))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Retry publish' }))

    await waitFor(() => expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1'))
    expect(mockedApi.approveCampaign).not.toHaveBeenCalled()
  })

  it('shows an error if publishing fails', async () => {
    mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
    mockedApi.publishCampaign.mockRejectedValue(new api.ApiError(400, 'Connect Meta Ads first'))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Connect Meta Ads first')
  })

  it('does not show a publish button for a campaign that is not yet publishable', async () => {
    mockedApi.listCampaigns.mockResolvedValue([makeCampaign({ status: 'DRAFT' })])

    renderPage()
    await screen.findByText('Handmade wallets, made to last')

    expect(screen.queryByRole('button', { name: /Approve & Publish|Retry publish/ })).not.toBeInTheDocument()
  })

  it('does not show the image picker when the campaign has no product', async () => {
    mockedApi.listCampaigns.mockResolvedValue([makeCampaign({ productId: null })])

    renderPage()
    await screen.findByText('Handmade wallets, made to last')

    expect(screen.queryByRole('button', { name: 'Upload Image' })).not.toBeInTheDocument()
  })
})
