import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdPreviewPage } from './AdPreviewPage'
import * as api from '../lib/api'

// The publish job is polled every two seconds in the app; tests poll quickly.
vi.mock('../lib/publishJob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/publishJob')>()
  return {
    ...actual,
    waitForPublishJob: (
      ...[businessId, campaignId, onStatus, options]: Parameters<typeof actual.waitForPublishJob>
    ) =>
      actual.waitForPublishJob(businessId, campaignId, onStatus, {
        intervalMs: 0,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 30)),
        ...options,
      }),
  }
})

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
    getPublishStatus: vi.fn<typeof actual.getPublishStatus>(),
    setCreativeStoryAsset: vi.fn<typeof actual.setCreativeStoryAsset>(),
    reorderCreativeCards: vi.fn<typeof actual.reorderCreativeCards>(),
    removeCreativeCard: vi.fn<typeof actual.removeCreativeCard>(),
    deselectCreative: vi.fn<typeof actual.deselectCreative>(),
    getStrategy: vi.fn<typeof actual.getStrategy>(),
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
    format: 'SINGLE_IMAGE',
    cards: [],
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
  window.sessionStorage.clear()
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
    voiceTraits: [],
    pricePositionings: [],
  })
  mockedApi.listCampaigns.mockResolvedValue([makeCampaign()])
  mockedApi.listCreatives.mockResolvedValue([makeCreative()])
  mockedApi.getStrategy.mockRejectedValue(new api.ApiError(404, 'Strategy not found'))
})

// Only the plan type matters to this page.
function strategyOf(planType: string): api.Strategy {
  return {
    id: 'strat-1',
    campaignId: 'camp-1',
    createdAt: '2026-10-06T00:00:00Z',
    content: { planType } as api.Strategy['content'],
  }
}

describe('AdPreviewPage', () => {
  it('has a round back button before the title that returns to the ad choices', async () => {
    function ChoicesStub() {
      const { pathname, search } = useLocation()
      return <p>{`Ad choices at ${pathname}${search}`}</p>
    }
    render(
      <MemoryRouter initialEntries={['/businesses/biz-1/campaigns/camp-1/ad']}>
        <Routes>
          <Route
            path="/businesses/:businessId/campaigns/:campaignId/ad"
            element={<AdPreviewPage />}
          />
          <Route path="/businesses/:businessId" element={<ChoicesStub />} />
        </Routes>
      </MemoryRouter>,
    )

    const back = await screen.findByRole('button', { name: 'Back to ad choices' })
    expect(back).toHaveClass('back-button')
    expect(screen.queryByRole('link', { name: /Back to dashboard/ })).not.toBeInTheDocument()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await userEvent.click(back)

    // Straight to the business page, staying on the campaigns even if Meta is not connected yet.
    expect(
      await screen.findByText('Ad choices at /businesses/biz-1?metaLater=1&campaign=camp-1'),
    ).toBeInTheDocument()
  })

  describe('the preview workspace', () => {
    const three = [
      makeCreative({ id: 'creative-1', headline: 'Angle one headline', imageUrl: '/img-1' }),
      makeCreative({ id: 'creative-2', headline: 'Angle two headline', imageUrl: '/img-2' }),
      makeCreative({ id: 'creative-3', headline: 'Angle three headline', imageUrl: '/img-3' }),
    ]

    beforeEach(() => {
      mockedApi.getStrategy.mockResolvedValue(strategyOf('CREATIVE_TEST_PLAN'))
      mockedApi.getOptions.mockResolvedValue({
        industries: [],
        objectives: [{ value: 'SALES', label: 'Sales' }],
        campaignStatuses: [{ value: 'PAUSED', label: 'Paused' }],
        ctas: [{ value: 'SHOP_NOW', label: 'Shop Now' }],
        actionTypes: [],
        eventVenues: [],
        voiceTraits: [],
        pricePositionings: [],
      })
    })

    it('titles the page with the campaign, its type and its ad count, and a review badge that matches its state', async () => {
      mockedApi.listCreatives.mockResolvedValue(three)

      renderPage()

      expect(await screen.findByRole('heading', { level: 1, name: 'first campaign' })).toBeInTheDocument()
      expect(await screen.findByText('Sales campaign · 3 ads')).toBeInTheDocument()
      expect(screen.getByText('Ready for review')).toBeInTheDocument()
    })

    it('shows no review badge when the campaign is not awaiting review', async () => {
      mockedApi.listCampaigns.mockResolvedValue([makeCampaign({ status: 'ADS_GENERATED' })])

      renderPage()
      await screen.findByRole('tabpanel')

      expect(screen.queryByText('Ready for review')).not.toBeInTheDocument()
    })

    it('shows the status instead for a published campaign', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        makeCampaign({ status: 'PAUSED', metaCampaignId: 'meta-1' }),
      ])

      renderPage()

      expect(await screen.findByText('Paused')).toHaveClass('review-badge')
      expect(screen.queryByText('Ready for review')).not.toBeInTheDocument()
    })

    it('fills the details panel from the ad being previewed and updates it with the platform and creative', async () => {
      mockedApi.listCreatives.mockResolvedValue(three)
      const user = userEvent.setup()

      renderPage()
      const details = within(await screen.findByRole('complementary', { name: 'Preview details' }))

      expect(details.getByText('Facebook')).toBeInTheDocument()
      expect(details.getByText('Feed')).toBeInTheDocument()
      expect(details.getByText('4:5')).toBeInTheDocument()
      expect(details.getByText('1 of 3')).toBeInTheDocument()
      expect(details.getByText('Angle one headline')).toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Instagram' }))
      await user.click(screen.getByRole('button', { name: 'Next creative' }))

      expect(details.getByText('Instagram')).toBeInTheDocument()
      expect(details.getByText('2 of 3')).toBeInTheDocument()
      expect(details.getByText('Angle two headline')).toBeInTheDocument()
      expect(mockedApi.selectCreative).not.toHaveBeenCalled()
      expect(mockedApi.publishCampaign).not.toHaveBeenCalled()
    })

    it('shows the ratio of the placement being previewed', async () => {
      mockedApi.listCreatives.mockResolvedValue([
        makeCreative({ imageUrl: '/f', storyAssetId: 's1', storyImageUrl: '/s' }),
      ])
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('tabpanel')
      await user.click(screen.getByRole('button', { name: 'Stories & Reels' }))

      const details = within(screen.getByRole('complementary', { name: 'Preview details' }))
      expect(details.getByText('9:16')).toBeInTheDocument()
      expect(details.getByText('Placement').nextElementSibling).toHaveTextContent('Stories & Reels')
    })

    it('puts Remove from test in Test settings for an ad in a test, and takes only that ad out', async () => {
      mockedApi.listCreatives.mockResolvedValueOnce(three)
      mockedApi.listCreatives.mockResolvedValue(three.slice(1))
      mockedApi.deselectCreative.mockResolvedValue(makeCreative({ id: 'creative-1', status: 'GENERATED' }))
      const user = userEvent.setup()

      renderPage()
      const settings = within(await screen.findByRole('region', { name: 'Test settings' }))
      expect(settings.getByText(/does not delete it/)).toBeInTheDocument()

      await user.click(settings.getByRole('button', { name: 'Remove from test' }))

      await waitFor(() =>
        expect(mockedApi.deselectCreative).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1'),
      )
      // The list refreshes, so the removed ad is gone and the next one is previewed.
      expect(await screen.findByText('2 ads in this test')).toBeInTheDocument()
      expect(within(screen.getByRole('tabpanel')).getByText('Angle two headline')).toBeInTheDocument()
    })

    it('shows why removing an ad from the test failed', async () => {
      mockedApi.listCreatives.mockResolvedValue(three)
      mockedApi.deselectCreative.mockRejectedValue(new api.ApiError(400, 'Cannot remove'))
      const user = userEvent.setup()

      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Remove from test' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Cannot remove')
    })

    it('has no Test settings for a campaign that is not a creative test', async () => {
      mockedApi.getStrategy.mockRejectedValue(new api.ApiError(404, 'Strategy not found'))
      mockedApi.listCreatives.mockResolvedValue([three[0]])

      renderPage()
      await screen.findByRole('tabpanel')

      expect(screen.queryByRole('region', { name: 'Test settings' })).not.toBeInTheDocument()
    })

    it('offers no Remove from test once the test is published', async () => {
      mockedApi.listCreatives.mockResolvedValue(three)
      mockedApi.listCampaigns.mockResolvedValue([
        makeCampaign({ status: 'PAUSED', metaCampaignId: 'meta-1' }),
      ])

      renderPage()

      expect(await screen.findByRole('region', { name: 'Test settings' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove from test' })).not.toBeInTheDocument()
    })

    it('puts Approve & Publish in its own bar, with the paused choice beside it', async () => {
      renderPage()

      const button = await screen.findByRole('button', { name: 'Approve & Publish' })
      const bar = button.closest('.ad-publish') as HTMLElement
      expect(bar).not.toBeNull()
      expect(within(bar).getByLabelText(/Publish paused/)).toBeChecked()
      // Not inside the details panel; the page decides where the bar sits.
      expect(screen.getByRole('complementary', { name: 'Preview details' })).not.toContainElement(button)
    })

    it('says plainly that publishing live can spend, once paused is turned off', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(await screen.findByLabelText(/Publish paused/))

      expect(screen.getByText(/can start spending as soon as Meta approves it/)).toBeInTheDocument()
    })

    it('explains why there is nothing to publish yet, instead of an empty gap', async () => {
      mockedApi.listCampaigns.mockResolvedValue([makeCampaign({ status: 'ADS_GENERATED' })])

      renderPage()

      expect(await screen.findByText(/isn.t ready to publish yet/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Approve & Publish' })).not.toBeInTheDocument()
    })

    it('copies the ad text when the browser allows it', async () => {
      const user = userEvent.setup()
      // user-event installs its own clipboard, so put ours in after it.
      const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Copy ad text' }))

      expect(writeText).toHaveBeenCalledWith(
        'Handmade wallets, made to last\n\nFull-grain leather, hand-stitched.\n\nShop the collection today.',
      )
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    })

    it('hides the copy action where the browser has no clipboard', async () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

      renderPage()
      await screen.findByRole('tabpanel')

      expect(screen.queryByRole('button', { name: 'Copy ad text' })).not.toBeInTheDocument()
    })

    it('keeps the carousel editor for a single carousel ad, without platform tabs', async () => {
      mockedApi.listCreatives.mockResolvedValue([
        makeCreative({
          format: 'CAROUSEL',
          cards: [
            { id: 'k1', position: 0, imageUrl: '/k1', headline: 'Card one', description: null, linkUrl: 'https://x.example' },
            { id: 'k2', position: 1, imageUrl: '/k2', headline: 'Card two', description: null, linkUrl: 'https://x.example' },
          ],
        }),
      ])

      renderPage()

      expect((await screen.findAllByText('Card one')).length).toBeGreaterThan(0)
      expect(screen.queryByRole('tablist', { name: 'Platform' })).not.toBeInTheDocument()
      expect(screen.getByText('Feed (carousel)')).toBeInTheDocument()
    })
  })

  it('shows the selected ad as a social-post preview', async () => {
    renderPage()

    const post = within(await screen.findByRole('tabpanel'))
    expect(post.getByText('Handmade wallets, made to last')).toBeInTheDocument()
    expect(post.getByText('Full-grain leather, hand-stitched.')).toBeInTheDocument()
    expect(post.getByText('Shop the collection today.')).toBeInTheDocument()
    expect(post.getByText('Shop Now')).toBeInTheDocument()
    expect(post.getByText('Acme Widgets')).toBeInTheDocument()
    expect(post.getByText('Sponsored')).toBeInTheDocument()
  })

  it("shows the business's own logo as the post avatar when one is uploaded", async () => {
    mockedApi.getBusiness.mockResolvedValue({
      ...business,
      logoUrl: 'http://localhost:8000/business-logos/biz-1',
    })

    renderPage()

    const avatar = await screen.findByAltText('')
    expect(avatar).toHaveAttribute('src', 'http://localhost:8000/business-logos/biz-1')
  })

  it('falls back to an initial when the business has no logo', async () => {
    renderPage()

    expect(await screen.findByText('A')).toBeInTheDocument()
    expect(screen.queryByAltText('')).not.toBeInTheDocument()
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
    await screen.findByRole('tabpanel')
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
    await screen.findByRole('tabpanel')
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
    expect(
      screen.getByText("Videos can be added in the product's photos. Video ads are coming later."),
    ).toBeInTheDocument()
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

  it('styles Approve & Publish in the same gold as the Create campaign button', async () => {
    renderPage()

    const button = await screen.findByRole('button', { name: 'Approve & Publish' })
    // btn-gold is the gold-token style the outlined buttons use (--create-bg), not the default purple.
    expect(button).toHaveClass('btn-outline', 'btn-gold')
  })

  it('approves and publishes a pending campaign', async () => {
    mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
    mockedApi.publishCampaign.mockResolvedValue(makeCampaign({ status: 'LIVE' }))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

    await waitFor(() => expect(mockedApi.approveCampaign).toHaveBeenCalledWith('biz-1', 'camp-1'))
    expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
      paused: true,
    })
  })

  it('publishes paused by default, with a checkbox that says so', async () => {
    mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
    mockedApi.publishCampaign.mockResolvedValue(makeCampaign({ status: 'PAUSED' }))
    const user = userEvent.setup()

    renderPage()
    const checkbox = await screen.findByLabelText(/Publish paused/)
    expect(checkbox).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Approve & Publish' }))

    await waitFor(() =>
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        paused: true,
      }),
    )
  })

  it('publishes live only when Publish paused is unchecked', async () => {
    mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
    mockedApi.publishCampaign.mockResolvedValue(makeCampaign({ status: 'LIVE' }))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByLabelText(/Publish paused/))
    await user.click(screen.getByRole('button', { name: 'Approve & Publish' }))

    await waitFor(() =>
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        paused: false,
      }),
    )
  })

  it('keeps the unchecked choice when the page re-renders or remounts', async () => {
    const user = userEvent.setup()
    const first = render(
      <MemoryRouter initialEntries={['/businesses/biz-1/campaigns/camp-1/ad']}>
        <Routes>
          <Route
            path="/businesses/:businessId/campaigns/:campaignId/ad"
            element={<AdPreviewPage />}
          />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(await screen.findByLabelText(/Publish paused/))
    expect(screen.getByLabelText(/Publish paused/)).not.toBeChecked()

    // Something remounts the page (a late auth re-render, a route change).
    first.unmount()
    renderPage()

    expect(await screen.findByLabelText(/Publish paused/)).not.toBeChecked()
  })

  it('carries a choice made on the dashboard over to the ad page', async () => {
    // CampaignsSection, on the dashboard, stores the choice under this key.
    window.sessionStorage.setItem('publishPaused:camp-1', 'false')
    mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
    mockedApi.publishCampaign.mockResolvedValue(makeCampaign({ status: 'LIVE' }))
    const user = userEvent.setup()

    renderPage()
    expect(await screen.findByLabelText(/Publish paused/)).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Approve & Publish' }))

    await waitFor(() =>
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
        paused: false,
      }),
    )
  })

  it('forgets the choice after a successful publish', async () => {
    window.sessionStorage.setItem('publishPaused:camp-1', 'false')
    mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
    mockedApi.publishCampaign.mockResolvedValue(makeCampaign({ status: 'LIVE' }))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

    await waitFor(() => expect(mockedApi.publishCampaign).toHaveBeenCalled())
    expect(window.sessionStorage.getItem('publishPaused:camp-1')).toBeNull()
  })

  it('keeps the choice if publishing fails, so a retry uses it', async () => {
    window.sessionStorage.setItem('publishPaused:camp-1', 'false')
    mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
    mockedApi.publishCampaign.mockRejectedValue(new api.ApiError(400, 'Meta says no'))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Meta says no')
    expect(window.sessionStorage.getItem('publishPaused:camp-1')).toBe('false')
  })

  describe('a creative test with several selected ads', () => {
    const three = [
      makeCreative({ id: 'creative-1', headline: 'Angle one headline' }),
      makeCreative({ id: 'creative-2', headline: 'Angle two headline' }),
      makeCreative({ id: 'creative-3', headline: 'Angle three headline' }),
      makeCreative({ id: 'creative-4', headline: 'Not in the test', status: 'GENERATED' }),
    ]

    beforeEach(() => {
      mockedApi.getStrategy.mockResolvedValue(strategyOf('CREATIVE_TEST_PLAN'))
    })

    it('previews the selected ads one at a time and none of the unselected ones', async () => {
      mockedApi.listCreatives.mockResolvedValue(three)
      const user = userEvent.setup()

      renderPage()
      const preview = within(await screen.findByRole('tabpanel'))

      // The first ad is previewed; the others are a click away, and the unselected one is not offered.
      expect(preview.getByText('Angle one headline')).toBeInTheDocument()
      expect(document.querySelector('.pager-position')).toHaveTextContent('1 of 3')
      expect(screen.getAllByRole('button', { name: /^View creative/ })).toHaveLength(3)
      expect(screen.queryByText('Not in the test')).not.toBeInTheDocument()
      expect(screen.getByText('3 ads in this test')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Next creative' }))
      expect(within(screen.getByRole('tabpanel')).getByText('Angle two headline')).toBeInTheDocument()
      expect(document.querySelector('.pager-position')).toHaveTextContent('2 of 3')
      expect(mockedApi.selectCreative).not.toHaveBeenCalled()
    })

    it('offers the image picker for the ad being previewed', async () => {
      mockedApi.listCreatives.mockResolvedValue(three)

      renderPage()
      await screen.findByRole('tabpanel')

      expect(await screen.findByRole('button', { name: /Upload Image|Change image/ })).toBeInTheDocument()
    })

    it('approves and publishes the whole test paused', async () => {
      mockedApi.listCreatives.mockResolvedValue(three)
      mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
      mockedApi.publishCampaign.mockResolvedValue(makeCampaign({ status: 'PAUSED' }))
      const user = userEvent.setup()

      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

      await waitFor(() =>
        expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', {
          paused: true,
        }),
      )
    })
  })

  it('retries publishing a failed campaign without re-approving', async () => {
    mockedApi.listCampaigns.mockResolvedValue([makeCampaign({ status: 'FAILED' })])
    mockedApi.publishCampaign.mockResolvedValue(makeCampaign({ status: 'LIVE' }))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Retry publish' }))

    await waitFor(() =>
      expect(mockedApi.publishCampaign).toHaveBeenCalledWith('biz-1', 'camp-1', { paused: true }),
    )
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
    await screen.findByRole('tabpanel')

    expect(screen.queryByRole('button', { name: /Approve & Publish|Retry publish/ })).not.toBeInTheDocument()
  })

  it('does not show the image picker when the campaign has no product', async () => {
    mockedApi.listCampaigns.mockResolvedValue([makeCampaign({ productId: null })])

    renderPage()
    await screen.findByRole('tabpanel')

    expect(screen.queryByRole('button', { name: 'Upload Image' })).not.toBeInTheDocument()
  })

  describe('a standard campaign with several selected ads', () => {
    const two = [
      makeCreative({ id: 'creative-1', headline: 'Angle one headline' }),
      makeCreative({ id: 'creative-2', headline: 'Angle two headline' }),
      makeCreative({ id: 'creative-3', headline: 'Not chosen', status: 'GENERATED' }),
    ]

    beforeEach(() => {
      mockedApi.getStrategy.mockResolvedValue(strategyOf('DATA_DRIVEN_STRATEGY'))
      mockedApi.listCreatives.mockResolvedValue(two)
    })

    it('says the ads run together as a campaign, with no test settings', async () => {
      renderPage()

      const section = within(await screen.findByRole('region', { name: 'Your ads' }))
      expect(section.getByText('2 ads in this campaign')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Test settings' })).not.toBeInTheDocument()
      expect(document.querySelector('.pager-position')).toHaveTextContent('1 of 2')
    })

    it('takes one ad out of the campaign without calling it a test', async () => {
      mockedApi.listCreatives.mockResolvedValueOnce(two)
      mockedApi.listCreatives.mockResolvedValue(two.slice(1))
      mockedApi.deselectCreative.mockResolvedValue(
        makeCreative({ id: 'creative-1', status: 'GENERATED' }),
      )
      const user = userEvent.setup()

      renderPage()
      const section = within(await screen.findByRole('region', { name: 'Your ads' }))
      expect(section.queryByRole('button', { name: 'Remove from test' })).not.toBeInTheDocument()
      await user.click(section.getByRole('button', { name: 'Remove this ad' }))

      await waitFor(() =>
        expect(mockedApi.deselectCreative).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1'),
      )
      expect(await screen.findByText('1 ad in this campaign')).toBeInTheDocument()
    })

    it('shows one ad, with the same section, for a standard campaign with a single selection', async () => {
      mockedApi.listCreatives.mockResolvedValue([two[0]])

      renderPage()

      expect(await screen.findByText('1 ad in this campaign')).toBeInTheDocument()
    })
  })

  describe('an audience test', () => {
    it('previews its one ad with no section for adding or removing ads', async () => {
      mockedApi.getStrategy.mockResolvedValue(strategyOf('TEST_PLAN'))

      renderPage()
      await screen.findByRole('tabpanel')

      expect(screen.queryByRole('region', { name: 'Your ads' })).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Test settings' })).not.toBeInTheDocument()
    })
  })

  describe('a published campaign', () => {
    const LOCKED = 'This campaign is already published. Create a new campaign to change its ads.'

    // LIVE, PAUSED, and a pre-publish status an old bug could leave it in: all
    // published, because they have a Meta id.
    it.each(['LIVE', 'PAUSED', 'APPROVED', 'ADS_GENERATED'])(
      'cannot be edited or published again from the ad page (%s)',
      async (status) => {
        mockedApi.listCampaigns.mockResolvedValue([
          makeCampaign({ status, metaCampaignId: 'meta_campaign_1' }),
        ])
        mockedApi.listCreatives.mockResolvedValue([makeCreative({ status: 'SELECTED' })])

        renderPage()

        expect(await screen.findByText(LOCKED)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Change image' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Upload Image' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Approve & Publish|Retry publish/ })).not.toBeInTheDocument()
        expect(screen.queryByLabelText(/Publish paused/)).not.toBeInTheDocument()
      },
    )

    it('has no carousel card controls', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        makeCampaign({ status: 'LIVE', metaCampaignId: 'meta_campaign_1' }),
      ])
      mockedApi.listCreatives.mockResolvedValue([
        makeCreative({
          status: 'SELECTED',
          format: 'CAROUSEL',
          cards: [
            { id: 'card-1', position: 0, imageUrl: 'http://x/1', headline: 'Card 1', description: null, linkUrl: 'http://x' },
            { id: 'card-2', position: 1, imageUrl: 'http://x/2', headline: 'Card 2', description: null, linkUrl: 'http://x' },
          ],
        }),
      ])

      renderPage()

      expect(await screen.findByText(LOCKED)).toBeInTheDocument()
      // The slides can still be browsed, but not edited.
      expect(screen.getByRole('list', { name: 'Carousel slides' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Move earlier' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Remove slide/ })).not.toBeInTheDocument()
    })

    it('keeps the ads editable for a campaign that is not published', async () => {
      mockedApi.listCampaigns.mockResolvedValue([makeCampaign()])

      renderPage()

      expect(await screen.findByRole('button', { name: 'Approve & Publish' })).toBeInTheDocument()
      expect(screen.queryByText(LOCKED)).not.toBeInTheDocument()
    })
  })

  describe('a CAROUSEL creative', () => {
    function makeCarouselCreative(overrides: Partial<api.Creative> = {}): api.Creative {
      return makeCreative({
        format: 'CAROUSEL',
        cards: [
          { id: 'card-1', position: 0, imageUrl: 'http://x/1', headline: 'Card 1', description: null, linkUrl: 'http://x' },
          { id: 'card-2', position: 1, imageUrl: 'http://x/2', headline: 'Card 2', description: null, linkUrl: 'http://x' },
          { id: 'card-3', position: 2, imageUrl: 'http://x/3', headline: 'Card 3', description: null, linkUrl: 'http://x' },
        ],
        ...overrides,
      })
    }

    it('shows the preview-first carousel editor instead of the single-image picker', async () => {
      mockedApi.listCreatives.mockResolvedValue([makeCarouselCreative()])

      renderPage()

      const rail = await screen.findByRole('list', { name: 'Carousel slides' })
      expect(within(rail).getByRole('button', { name: /Card 1$/ })).toBeInTheDocument()
      expect(within(rail).getByRole('button', { name: /Card 2$/ })).toBeInTheDocument()
      expect(within(rail).getByRole('button', { name: /Card 3$/ })).toBeInTheDocument()
      expect(screen.getByText('Slide 1 of 3')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Upload Image' })).not.toBeInTheDocument()
    })

    it('reorders a card earlier', async () => {
      mockedApi.listCreatives.mockResolvedValue([makeCarouselCreative()])
      mockedApi.reorderCreativeCards.mockResolvedValue(
        makeCarouselCreative({
          cards: [
            { id: 'card-2', position: 0, imageUrl: 'http://x/2', headline: 'Card 2', description: null, linkUrl: 'http://x' },
            { id: 'card-1', position: 1, imageUrl: 'http://x/1', headline: 'Card 1', description: null, linkUrl: 'http://x' },
            { id: 'card-3', position: 2, imageUrl: 'http://x/3', headline: 'Card 3', description: null, linkUrl: 'http://x' },
          ],
        }),
      )
      const user = userEvent.setup()

      renderPage()
      await user.click(await screen.findByRole('button', { name: /^Slide 2 of 3/ }))
      await user.click(screen.getByRole('button', { name: 'Move earlier' }))

      await waitFor(() =>
        expect(mockedApi.reorderCreativeCards).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1', [
          'card-2',
          'card-1',
          'card-3',
        ]),
      )
    })

    it('reorders a card later', async () => {
      mockedApi.listCreatives.mockResolvedValue([makeCarouselCreative()])
      mockedApi.reorderCreativeCards.mockResolvedValue(makeCarouselCreative())
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('list', { name: 'Carousel slides' })
      await user.click(screen.getByRole('button', { name: 'Move later' }))

      await waitFor(() =>
        expect(mockedApi.reorderCreativeCards).toHaveBeenCalledWith('biz-1', 'camp-1', 'creative-1', [
          'card-2',
          'card-1',
          'card-3',
        ]),
      )
    })

    it('shows an error if reordering fails', async () => {
      mockedApi.listCreatives.mockResolvedValue([makeCarouselCreative()])
      mockedApi.reorderCreativeCards.mockRejectedValue(new api.ApiError(400, 'Could not reorder.'))
      const user = userEvent.setup()

      renderPage()
      await user.click(await screen.findByRole('button', { name: /^Slide 2 of 3/ }))
      await user.click(screen.getByRole('button', { name: 'Move earlier' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not reorder.')
    })

    it('removes a card', async () => {
      mockedApi.listCreatives.mockResolvedValue([makeCarouselCreative()])
      mockedApi.removeCreativeCard.mockResolvedValue(
        makeCarouselCreative({
          cards: [
            { id: 'card-1', position: 0, imageUrl: 'http://x/1', headline: 'Card 1', description: null, linkUrl: 'http://x' },
            { id: 'card-3', position: 1, imageUrl: 'http://x/3', headline: 'Card 3', description: null, linkUrl: 'http://x' },
          ],
        }),
      )
      const user = userEvent.setup()

      renderPage()
      await user.click(await screen.findByRole('button', { name: /^Slide 2 of 3/ }))
      await user.click(screen.getByRole('button', { name: 'Remove slide 2' }))

      await waitFor(() =>
        expect(mockedApi.removeCreativeCard).toHaveBeenCalledWith(
          'biz-1',
          'camp-1',
          'creative-1',
          'card-2',
        ),
      )
      const rail = await screen.findByRole('list', { name: 'Carousel slides' })
      expect(within(rail).getByRole('button', { name: /Card 3$/ })).toBeInTheDocument()
      expect(within(rail).queryByRole('button', { name: /Card 2$/ })).not.toBeInTheDocument()
    })

    it('shows an error if removing the last-allowed card fails', async () => {
      mockedApi.listCreatives.mockResolvedValue([makeCarouselCreative()])
      mockedApi.removeCreativeCard.mockRejectedValue(
        new api.ApiError(400, 'A carousel needs at least 2 cards'),
      )
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('list', { name: 'Carousel slides' })
      await user.click(screen.getByRole('button', { name: 'Remove slide 1' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('A carousel needs at least 2 cards')
    })

    it('shows a generic error if removing a card fails for an unexpected reason', async () => {
      mockedApi.listCreatives.mockResolvedValue([makeCarouselCreative()])
      mockedApi.removeCreativeCard.mockRejectedValue(new Error('network down'))
      const user = userEvent.setup()

      renderPage()
      await screen.findByRole('list', { name: 'Carousel slides' })
      await user.click(screen.getByRole('button', { name: 'Remove slide 1' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove this card.')
    })
  })

  describe('publishing a video ad', () => {
    beforeEach(() => {
      mockedApi.listCreatives.mockResolvedValue([
        makeCreative({
          format: 'SINGLE_VIDEO',
          imageUrl: 'http://localhost:8000/product-images/v1/thumbnail',
          videoUrl: 'http://localhost:8000/product-images/v1',
        }),
      ])
    })

    it('offers Change video instead of a photo picker for a video ad', async () => {
      mockedApi.listProductImages.mockResolvedValue([
        {
          id: 'v1',
          url: 'http://localhost:8000/product-images/v1',
          thumbnailUrl: 'http://localhost:8000/product-images/v1/thumbnail',
          createdAt: '',
          mediaType: 'VIDEO',
          durationSeconds: 10,
          aspectClass: 'STORY',
        },
      ])
      const user = userEvent.setup()
      renderPage()
      await screen.findByRole('button', { name: 'Play video' })

      expect(screen.queryByRole('button', { name: 'Change image' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Upload Image' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Change video' }))

      expect(await screen.findByLabelText('Upload a new video')).toBeInTheDocument()
      expect(await screen.findAllByAltText('Product video option')).toHaveLength(1)
    })

    it('previews the video ad with a play button', async () => {
      renderPage()

      expect(await screen.findByRole('button', { name: 'Play video' })).toBeInTheDocument()
    })

    it('shows a visible processing state, then finishes, instead of looking frozen', async () => {
      mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
      mockedApi.publishCampaign.mockResolvedValue(
        makeCampaign({ status: 'APPROVED', publishing: true }),
      )
      // The third status call waits on a gate the test opens, so the "55%"
      // state holds for as long as the assertions need instead of racing the
      // poller (which moves on every 30ms).
      let finishJob: () => void = () => {}
      const jobGate = new Promise<void>((resolve) => {
        finishJob = resolve
      })
      mockedApi.getPublishStatus
        .mockResolvedValueOnce({ state: 'PROCESSING', step: 'Uploading video' })
        .mockResolvedValueOnce({
          state: 'PROCESSING',
          step: 'Processing video',
          progress: 55,
          elapsedSeconds: 20,
        })
        .mockImplementationOnce(async () => {
          await jobGate
          return { state: 'DONE' }
        })
      const user = userEvent.setup()

      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

      // Wait for the disabled state explicitly: the button reads "Processing
      // video… 55%" and cannot be clicked again.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Processing video… 55%/ })).toBeDisabled(),
      )
      await waitFor(() => expect(mockedApi.getPublishStatus).toHaveBeenCalledTimes(3))
      expect(screen.getByRole('button', { name: /Processing video… 55%/ })).toBeDisabled()

      finishJob()

      await waitFor(() =>
        expect(screen.queryByText(/Processing video/)).not.toBeInTheDocument(),
      )
    })

    it('shows why a background publish failed and allows a retry', async () => {
      mockedApi.approveCampaign.mockResolvedValue(makeCampaign({ status: 'APPROVED' }))
      mockedApi.publishCampaign.mockResolvedValue(
        makeCampaign({ status: 'APPROVED', publishing: true }),
      )
      mockedApi.getPublishStatus.mockResolvedValue({
        state: 'FAILED',
        error: 'Meta is still processing the video after 300 seconds.',
      })
      const user = userEvent.setup()

      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Approve & Publish' }))

      expect(await screen.findByText(/still processing the video/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Approve & Publish' })).toBeEnabled()
    })

    it('resumes the progress display after a reload mid-publish', async () => {
      mockedApi.listCampaigns.mockResolvedValue([
        makeCampaign({ status: 'APPROVED', publishing: true }),
      ])
      mockedApi.getPublishStatus
        .mockResolvedValueOnce({ state: 'PROCESSING', step: 'Processing video', progress: 30 })
        .mockResolvedValueOnce({ state: 'DONE' })

      renderPage()

      expect(await screen.findByText(/Processing video… 30%/)).toBeInTheDocument()
      await waitFor(() => expect(mockedApi.getPublishStatus).toHaveBeenCalledTimes(2))
      expect(mockedApi.publishCampaign).not.toHaveBeenCalled()
    })
  })

  it('offers the Stories & Reels and Square slots for a single image ad', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: 'Add Stories & Reels image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Square image' })).toBeInTheDocument()
    // The optional rows say what they are and that they are optional.
    expect(screen.getByRole('button', { name: 'Add Stories & Reels image' })).toHaveTextContent(
      '9:16 · Optional',
    )
    expect(screen.getByRole('button', { name: 'Add Square image' })).toHaveTextContent(
      '1:1 · Optional',
    )
  })

  it('shows the Feed / Story toggle once the ad has a story asset', async () => {
    mockedApi.listCreatives.mockResolvedValue([
      makeCreative({
        imageUrl: 'http://localhost:8000/product-images/f1',
        storyAssetId: 's1',
        storyImageUrl: 'http://localhost:8000/product-images/s1',
      }),
    ])

    renderPage()

    // Its own placement, available on both platforms.
    expect(await screen.findByRole('button', { name: 'Stories & Reels' })).toBeInTheDocument()
  })
})
