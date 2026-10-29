import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'
import { AuthProvider } from '../context/AuthContext'
import { ThemeProvider } from '../context/ThemeContext'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    signup: vi.fn<typeof actual.signup>(),
    login: vi.fn<typeof actual.login>(),
    logout: vi.fn<typeof actual.logout>(),
    getMe: vi.fn<typeof actual.getMe>(),
    getOptions: vi.fn<typeof actual.getOptions>(),
    createBusiness: vi.fn<typeof actual.createBusiness>(),
    listBusinesses: vi.fn<typeof actual.listBusinesses>(),
    uploadBusinessLogo: vi.fn<typeof actual.uploadBusinessLogo>(),
    deleteBusiness: vi.fn<typeof actual.deleteBusiness>(),
    updateBusiness: vi.fn<typeof actual.updateBusiness>(),
    listCampaigns: vi.fn<typeof actual.listCampaigns>(),
    getBrandProfile: vi.fn<typeof actual.getBrandProfile>(),
    createBrandProfile: vi.fn<typeof actual.createBrandProfile>(),
  }
})
const mockedApi = vi.mocked(api)

const INDUSTRY_OPTIONS = [
  { value: 'ECOMMERCE', label: 'E-commerce' },
  { value: 'FASHION_JEWELRY', label: 'Fashion / Jewelry' },
  { value: 'BEAUTY_COSMETICS', label: 'Beauty & Cosmetics' },
  { value: 'REAL_ESTATE', label: 'Real Estate' },
  { value: 'AUTOMOTIVE', label: 'Automotive' },
  { value: 'TRAVEL', label: 'Travel' },
  { value: 'RESTAURANTS_FOOD', label: 'Restaurants / Food' },
  { value: 'SAAS_TECHNOLOGY', label: 'SaaS / Technology' },
  { value: 'PROFESSIONAL_SERVICES', label: 'Professional Services' },
  { value: 'FITNESS_WELLNESS', label: 'Fitness / Wellness' },
  { value: 'OTHER', label: 'Other' },
]

beforeEach(() => {
  vi.resetAllMocks()
  // The Brand section under Company Information loads a profile for a business.
  mockedApi.getBrandProfile.mockRejectedValue(
    new api.ApiError(404, 'This business has no brand profile yet'),
  )
  mockedApi.getMe.mockResolvedValue({ id: '1', email: 'owner@example.com', needsTermsAcceptance: false })
  mockedApi.getOptions.mockResolvedValue({
    industries: INDUSTRY_OPTIONS,
    objectives: [],
    campaignStatuses: [],
    ctas: [],
    actionTypes: [],
    eventVenues: [],
    voiceTraits: [],
    pricePositionings: [],
  })
})

function BusinessStub() {
  const { businessId } = useParams()
  return (
    <p>
      Business detail page<span data-testid="stub-business-id">{businessId}</span>
    </p>
  )
}

function renderDashboard(entry = '/') {
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[entry]}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/businesses/:businessId" element={<BusinessStub />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

const brandFixture: api.BrandProfile = {
  id: 'brand-1',
  businessId: 'biz-1',
  description: 'Family-run studio making handcrafted gold jewelry.',
  idealCustomer: 'Women 30-55 buying for milestones.',
  voiceTraits: ['WARM'],
  pricePositioning: 'PREMIUM',
  brandPhrases: null,
  avoidPhrases: null,
  tagline: null,
  competitors: null,
  exampleCopy: null,
  proofPoints: [],
  offer: null,
  adLanguages: ['English'],
  logoUrl: null,
}

describe('DashboardPage', () => {
  it('shows the signed-in user and their businesses', async () => {
    mockedApi.listBusinesses.mockResolvedValue([
      {
        id: '1',
        name: 'Acme',
        website: null,
        industry: 'FASHION_JEWELRY',
        location: 'CDMX',
        logoUrl: null,
        description: null,
      },
    ])

    renderDashboard()

    await waitFor(() => expect(screen.getByText(/owner@example.com/)).toBeInTheDocument())
    expect(await screen.findByText('Acme')).toBeInTheDocument()
    // The friendly label, not the raw enum value (from the fetched industries list, not
    // hard-coded), with the place after it on the same muted line under the name.
    expect(await screen.findByText('Fashion / Jewelry · CDMX')).toHaveClass('business-item-meta')
  })

  describe('the business list', () => {
    const biz = (extra: Partial<api.Business>): api.Business => ({
      id: 'biz-1',
      name: 'VENZI JEWELRY',
      website: null,
      industry: null,
      location: null,
      logoUrl: null,
      description: null,
      ...extra,
    })

    it('puts the name first and the industry and place together on one muted line beneath it', async () => {
      mockedApi.listBusinesses.mockResolvedValue([
        biz({ industry: 'FASHION_JEWELRY', location: 'New York' }),
      ])

      renderDashboard()

      const item = (await screen.findByRole('link', { name: 'VENZI JEWELRY' })).closest('li') as HTMLElement
      expect(item.children).toHaveLength(2)
      expect(item.children[0]).toHaveTextContent('VENZI JEWELRY')
      expect(item.children[1]).toHaveTextContent('Fashion / Jewelry · New York')
    })

    it('shows just the place, or just the industry, without a stray separator', async () => {
      mockedApi.listBusinesses.mockResolvedValue([
        biz({ id: 'a', name: 'Only place', location: 'Austin' }),
        biz({ id: 'b', name: 'Only industry', industry: 'FASHION_JEWELRY' }),
        biz({ id: 'c', name: 'Neither' }),
      ])

      renderDashboard()

      const place = (await screen.findByRole('link', { name: 'Only place' })).closest('li') as HTMLElement
      expect(place.children[1]).toHaveTextContent(/^Austin$/)
      const industry = screen.getByRole('link', { name: 'Only industry' }).closest('li') as HTMLElement
      expect(industry.children[1]).toHaveTextContent(/^Fashion \/ Jewelry$/)
      const neither = screen.getByRole('link', { name: 'Neither' }).closest('li') as HTMLElement
      expect(neither.children).toHaveLength(1)
    })
  })

  describe('the page header', () => {
    it('has the logo, then the theme toggle and Log out together on the right, and one theme toggle on the page', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])

      renderDashboard()

      const header = (await screen.findByRole('heading', { name: 'Sales Guru' })).closest('header') as HTMLElement
      const actions = header.querySelector('.dashboard-header-actions') as HTMLElement
      expect(within(actions).getByRole('button', { name: /Switch to (dark|light) mode/ })).toBeInTheDocument()
      expect(within(actions).getByRole('button', { name: 'Log out' })).toBeInTheDocument()
      // The global top bar steps aside, so there is exactly one toggle.
      expect(screen.getAllByRole('button', { name: /Switch to (dark|light) mode/ })).toHaveLength(1)
    })

    it('shows "Signed in as" with the email truncatable and its full text on hover', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])

      renderDashboard()

      const email = await screen.findByText('owner@example.com')
      expect(email).toHaveClass('dashboard-email')
      expect(email).toHaveAttribute('title', 'owner@example.com')
      expect(email.closest('p')).toHaveTextContent('Signed in as owner@example.com')
      expect(email.closest('a')).toBeNull()
    })
  })

  describe('the Add Business button', () => {
    it('leads the Company Information button group, with a plus icon', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])

      renderDashboard()

      const button = await screen.findByRole('button', { name: 'Add Business' })
      // The heading sits alone; Add Business leads the same button group as Edit and Delete.
      expect(screen.getByRole('heading', { name: 'Company Information' })).toBeInTheDocument()
      const group = button.closest('.company-actions') as HTMLElement
      const buttons = within(group).getAllByRole('button')
      // (An account with no business yet sees the form, so Save sits second.)
      expect(buttons.map((b) => b.textContent)).toEqual([
        'Add Business',
        'Save Business',
        'Edit Business',
        'Delete Business',
      ])
      expect(button).toHaveClass('section-action-button')
      expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg')
      expect(button.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    })

    it('focuses the Name field of the Company Information form it sits in', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      const user = userEvent.setup()

      renderDashboard()
      await user.click(await screen.findByRole('button', { name: 'Add Business' }))

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
      expect(screen.getByLabelText('Name')).toHaveFocus()
    })

    it('scrolls without animation when the user prefers reduced motion', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      const originalMatchMedia = window.matchMedia
      window.matchMedia = ((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia
      const user = userEvent.setup()

      try {
        renderDashboard()
        await user.click(await screen.findByRole('button', { name: 'Add Business' }))

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
      } finally {
        window.matchMedia = originalMatchMedia
      }
    })

    it('hides the Company Information fields while a business exists, keeping Edit and Delete', async () => {
      mockedApi.listBusinesses.mockResolvedValue([
        {
          id: 'biz-1',
          name: 'Acme Widgets',
          website: null,
          industry: null,
          location: null,
          description: null,
          logoUrl: null,
        },
      ])

      renderDashboard()
      await screen.findByText('Acme Widgets')

      expect(screen.getByRole('heading', { name: 'Company Information' })).toBeInTheDocument()
      for (const label of ['Name', 'Website', 'Industry', 'Location']) {
        expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
      }
      expect(screen.queryByText(/About your business/)).not.toBeInTheDocument()
      expect(screen.queryByText(/^Logo/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save Business' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit Business' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete Business' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add Business' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })

    it('shows the logo, name, website, industry, location and about fields when Add Business is clicked, and focuses Name', async () => {
      mockedApi.listBusinesses.mockResolvedValue([
        {
          id: 'biz-1',
          name: 'Acme Widgets',
          website: null,
          industry: null,
          location: null,
          description: null,
          logoUrl: null,
        },
      ])
      Element.prototype.scrollIntoView = vi.fn()
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const add = screen.getByRole('button', { name: 'Add Business' })
      await user.click(add)

      expect(add).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(/^Logo/)).toBeInTheDocument()
      for (const label of ['Name', 'Website', 'Industry', 'Location']) {
        expect(screen.getByLabelText(label)).toBeInTheDocument()
      }
      expect(screen.getByLabelText(/About your business/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save Business' })).toBeInTheDocument()
      expect(screen.getByLabelText('Name')).toHaveFocus()
    })

    it('hides the fields again when Add Business is clicked a second time', async () => {
      mockedApi.listBusinesses.mockResolvedValue([
        {
          id: 'biz-1',
          name: 'Acme Widgets',
          website: null,
          industry: null,
          location: null,
          description: null,
          logoUrl: null,
        },
      ])
      Element.prototype.scrollIntoView = vi.fn()
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const add = screen.getByRole('button', { name: 'Add Business' })
      await user.click(add)
      await user.click(add)

      expect(add).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save Business' })).not.toBeInTheDocument()
    })

    describe('the circular close control', () => {
      const acme = {
        id: 'biz-1',
        name: 'Acme Widgets',
        website: null,
        industry: null,
        location: null,
        description: null,
        logoUrl: null,
      }

      it('is not shown while the form is closed', async () => {
        mockedApi.listBusinesses.mockResolvedValue([acme])

        renderDashboard()
        await screen.findByText('Acme Widgets')

        expect(
          screen.queryByRole('button', { name: 'Close Company Information' }),
        ).not.toBeInTheDocument()
      })

      it('sits immediately after Delete Business once the form is open', async () => {
        mockedApi.listBusinesses.mockResolvedValue([acme])
        Element.prototype.scrollIntoView = vi.fn<() => void>()
        const user = userEvent.setup()

        renderDashboard()
        await screen.findByText('Acme Widgets')
        await user.click(screen.getByRole('button', { name: 'Add Business' }))

        const close = screen.getByRole('button', { name: 'Close Company Information' })
        const del = screen.getByRole('button', { name: 'Delete Business' })
        expect(del.nextElementSibling).toBe(close)
        expect(close).toHaveAttribute('type', 'button')
      })

      it('collapses the form without deleting or discarding what was typed', async () => {
        mockedApi.listBusinesses.mockResolvedValue([acme])
        Element.prototype.scrollIntoView = vi.fn<() => void>()
        const user = userEvent.setup()

        renderDashboard()
        await screen.findByText('Acme Widgets')
        const add = screen.getByRole('button', { name: 'Add Business' })
        await user.click(add)
        await user.type(screen.getByLabelText('Name'), 'Half typed')
        await user.click(screen.getByRole('button', { name: 'Close Company Information' }))

        expect(add).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
        expect(mockedApi.deleteBusiness).not.toHaveBeenCalled()
        expect(mockedApi.createBusiness).not.toHaveBeenCalled()

        await user.click(add)
        expect(screen.getByLabelText('Name')).toHaveValue('Half typed')
      })

      it('is not offered when the form is the only thing on the page', async () => {
        mockedApi.listBusinesses.mockResolvedValue([])

        renderDashboard()

        await screen.findByLabelText('Name')
        expect(
          screen.queryByRole('button', { name: 'Close Company Information' }),
        ).not.toBeInTheDocument()
      })
    })

    it('shows the fields straight away for an account with no businesses yet', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])

      renderDashboard()

      expect(await screen.findByLabelText('Name')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save Business' })).toBeInTheDocument()
    })

    it('is shown when businesses already exist, and does not create anything itself', async () => {
      mockedApi.listBusinesses.mockResolvedValue([
        {
          id: 'biz-1',
          name: 'Acme Widgets',
          website: null,
          industry: null,
          location: null,
          description: null,
          logoUrl: null,
        },
      ])
      Element.prototype.scrollIntoView = vi.fn()
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Add Business' }))

      expect(mockedApi.createBusiness).not.toHaveBeenCalled()
    })
  })

  describe('the Brand section', () => {
    const brand: api.BrandProfile = {
      id: 'brand-1',
      businessId: 'biz-1',
      description: 'Family-run studio making handcrafted gold jewelry.',
      idealCustomer: 'Women 30-55 buying for milestones.',
      voiceTraits: ['WARM'],
      pricePositioning: 'PREMIUM',
      brandPhrases: null,
      avoidPhrases: null,
      tagline: null,
      competitors: null,
      exampleCopy: null,
      proofPoints: [],
      offer: null,
      adLanguages: ['English'],
      logoUrl: null,
    }
    const acme: api.Business = {
      id: 'biz-1',
      name: 'Acme Widgets',
      website: null,
      industry: null,
      location: null,
      description: null,
      logoUrl: null,
    }
    const globex: api.Business = { ...acme, id: 'biz-2', name: 'Globex' }

    it('confirms a saved brand profile and offers Continue to Meta connection settings', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.getOptions.mockResolvedValue({
        industries: INDUSTRY_OPTIONS,
        objectives: [],
        campaignStatuses: [],
        ctas: [],
        actionTypes: [],
        eventVenues: [],
        voiceTraits: [{ value: 'WARM', label: 'Warm' }],
        pricePositionings: [{ value: 'PREMIUM', label: 'Premium' }],
      })
      mockedApi.createBrandProfile.mockResolvedValue({ ...brand, description: 'Our brand.' })
      const user = userEvent.setup()

      renderDashboard()
      await user.type(await screen.findByLabelText(/Brand overview/), 'Our brand.')
      await user.type(screen.getByLabelText('Ideal customer'), 'Gift buyers.')
      await user.click(await screen.findByLabelText('Warm'))
      await user.selectOptions(screen.getByLabelText('Price positioning'), 'PREMIUM')
      // Nothing to continue to until it is saved.
      expect(
        screen.queryByRole('button', { name: 'Continue to Meta connection settings' }),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save brand profile' }))

      expect(await screen.findByText('Brand profile saved.')).toBeInTheDocument()
      expect(screen.getByText(/Every campaign for Acme Widgets will now use it/)).toBeInTheDocument()
      // The saved profile is shown, with the way to edit it.
      expect(screen.getByText('Our brand.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit brand profile' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Continue to Meta connection settings' }))

      // Goes on to that business's page, where the Meta step comes next.
      expect(await screen.findByText('Business detail page')).toBeInTheDocument()
    })

    it('lets you skip the Meta step for now from the saved confirmation, to the right of Continue', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.getOptions.mockResolvedValue({
        industries: INDUSTRY_OPTIONS,
        objectives: [],
        campaignStatuses: [],
        ctas: [],
        actionTypes: [],
        eventVenues: [],
        voiceTraits: [{ value: 'WARM', label: 'Warm' }],
        pricePositionings: [{ value: 'PREMIUM', label: 'Premium' }],
      })
      mockedApi.createBrandProfile.mockResolvedValue({ ...brand, description: 'Our brand.' })
      const user = userEvent.setup()

      renderDashboard()
      await user.type(await screen.findByLabelText(/Brand overview/), 'Our brand.')
      await user.type(screen.getByLabelText('Ideal customer'), 'Gift buyers.')
      await user.click(await screen.findByLabelText('Warm'))
      await user.selectOptions(screen.getByLabelText('Price positioning'), 'PREMIUM')
      // Nothing to skip until the profile is saved.
      expect(screen.queryByRole('link', { name: 'Skip for now' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save brand profile' }))

      const skip = await screen.findByRole('link', { name: 'Skip for now' })
      const next = screen.getByRole('button', { name: 'Continue to Meta connection settings' })
      expect(skip).toHaveAttribute('href', '/businesses/biz-1?skipMeta=1')
      // Same quiet underlined style as Cancel, right after Continue in the same row.
      expect(skip).toHaveClass('cancel-link')
      expect(next.nextElementSibling).toBe(skip)

      await user.click(skip)

      expect(await screen.findByText('Business detail page')).toBeInTheDocument()
    })

    it('does not show the Continue confirmation for a profile that already existed and was not just saved', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.getBrandProfile.mockResolvedValue(brand)

      renderDashboard()

      expect(await screen.findByText(brand.description)).toBeInTheDocument()
      expect(screen.queryByText('Brand profile saved.')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Continue to Meta connection settings' }),
      ).not.toBeInTheDocument()
    })

    it('opens the Brand form of the business named in ?brand= and clears the parameter', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme, globex])
      mockedApi.getBrandProfile.mockRejectedValue(new api.ApiError(404, 'no profile'))

      renderDashboard('/?brand=biz-2')

      await waitFor(() => expect(screen.getByLabelText(/Brand overview/)).toHaveFocus())
      expect(screen.getByLabelText('Business', { exact: true })).toHaveValue('biz-2')
      expect(mockedApi.getBrandProfile).toHaveBeenCalledWith('biz-2')
    })

    it('ignores a ?brand= that is not one of your businesses', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme, globex])
      mockedApi.getBrandProfile.mockRejectedValue(new api.ApiError(404, 'no profile'))

      renderDashboard('/?brand=someone-elses')

      await screen.findByLabelText(/Brand overview/)
      expect(screen.getByLabelText('Business', { exact: true })).toHaveValue('biz-1')
      expect(mockedApi.getBrandProfile).not.toHaveBeenCalledWith('someone-elses')
    })

    it('sits underneath the Company Information section', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.getBrandProfile.mockResolvedValue(brand)

      renderDashboard()

      const brandHeading = await screen.findByRole('heading', { name: 'Brand DNA' })
      const company = screen.getByRole('heading', { name: 'Company Information' })
      expect(
        company.compareDocumentPosition(brandHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('shows the profile summary and an Edit brand profile button for a business that has one', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.getBrandProfile.mockResolvedValue(brand)

      renderDashboard()

      expect(await screen.findByText(brand.description)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit brand profile' })).toBeInTheDocument()
      expect(mockedApi.getBrandProfile).toHaveBeenCalledWith('biz-1')
      // One business: no picker.
      expect(screen.queryByLabelText('Business')).not.toBeInTheDocument()
    })

    it('shows the brand form for a business without a profile yet', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])

      renderDashboard()

      expect(await screen.findByRole('button', { name: 'Save brand profile' })).toBeInTheDocument()
    })

    it('asks to add a business first when there are none', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])

      renderDashboard()

      expect(await screen.findByText(/Add a business above/)).toBeInTheDocument()
      expect(mockedApi.getBrandProfile).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: 'Save brand profile' })).not.toBeInTheDocument()
    })

    it('lets you pick which business when there are several, starting with the first', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme, globex])
      mockedApi.getBrandProfile.mockImplementation(async (businessId) => ({
        ...brand,
        businessId,
        description: businessId === 'biz-1' ? 'Acme brand story.' : 'Globex brand story.',
      }))
      const user = userEvent.setup()

      renderDashboard()

      expect(await screen.findByText('Acme brand story.')).toBeInTheDocument()
      const picker = screen.getByLabelText('Business')
      expect(picker).toHaveValue('biz-1')

      await user.selectOptions(picker, 'biz-2')

      expect(await screen.findByText('Globex brand story.')).toBeInTheDocument()
      expect(mockedApi.getBrandProfile).toHaveBeenCalledWith('biz-2')
      expect(screen.queryByText('Acme brand story.')).not.toBeInTheDocument()
    })

    it('does not carry an open brand edit over to another business', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme, globex])
      mockedApi.getBrandProfile.mockImplementation(async (businessId) => ({
        ...brand,
        businessId,
        description: businessId === 'biz-1' ? 'Acme brand story.' : 'Globex brand story.',
      }))
      const user = userEvent.setup()

      renderDashboard()
      await user.click(await screen.findByRole('button', { name: 'Edit brand profile' }))
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText('Business'), 'biz-2')

      expect(await screen.findByText('Globex brand story.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
  })

  it('shows an empty state when there are no businesses', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])

    renderDashboard()

    expect(await screen.findByText(/No businesses yet/)).toBeInTheDocument()
  })

  it('shows an error if the business list fails to load', async () => {
    mockedApi.listBusinesses.mockRejectedValue(new api.ApiError(500, 'Server error'))

    renderDashboard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('creates a business and takes you straight to its Brand form, ready to complete', async () => {
    const created: api.Business = {
      id: '1',
      name: 'Acme Widgets',
      website: 'https://acme.example',
      industry: 'FASHION_JEWELRY',
      location: 'CDMX',
      logoUrl: null,
      description: 'We make widgets.',
    }
    mockedApi.listBusinesses.mockResolvedValueOnce([]).mockResolvedValue([created])
    mockedApi.createBusiness.mockResolvedValue(created)
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    await user.type(screen.getByLabelText('Name'), 'Acme Widgets')
    await user.type(screen.getByLabelText('Website'), 'https://acme.example')
    await user.selectOptions(screen.getByLabelText('Industry'), 'FASHION_JEWELRY')
    await user.type(screen.getByLabelText('Location'), 'CDMX')
    await user.type(screen.getByLabelText(/About your business/), 'We make widgets.')
    await user.click(screen.getByRole('button', { name: 'Save Business' }))

    await waitFor(() =>
      expect(mockedApi.createBusiness).toHaveBeenCalledWith({
        name: 'Acme Widgets',
        website: 'https://acme.example',
        industry: 'FASHION_JEWELRY',
        location: 'CDMX',
        description: 'We make widgets.',
      }),
    )
    // Stays on the dashboard: the new business is listed and its Brand form is
    // open with the cursor in the first field.
    expect(await screen.findByRole('link', { name: 'Acme Widgets' })).toBeInTheDocument()
    const overview = await screen.findByLabelText(/Brand overview/)
    expect(overview).toHaveFocus()
    expect(mockedApi.getBrandProfile).toHaveBeenCalledWith('1')
    expect(screen.queryByText('Business detail page')).not.toBeInTheDocument()
    // The Company Information form is emptied and closed again.
    expect(screen.queryByLabelText('Name', { selector: '#name' })).not.toBeInTheDocument()
  })

  it('selects the new business in the Brand picker when others already exist', async () => {
    const existing: api.Business = {
      id: 'biz-old',
      name: 'Old Co',
      website: null,
      industry: null,
      location: null,
      logoUrl: null,
      description: null,
    }
    const created: api.Business = { ...existing, id: 'biz-new', name: 'New Co' }
    mockedApi.listBusinesses
      .mockResolvedValueOnce([existing])
      .mockResolvedValue([existing, created])
    mockedApi.createBusiness.mockResolvedValue(created)
    mockedApi.getBrandProfile.mockImplementation(async (businessId) => {
      if (businessId === 'biz-old') return { ...brandFixture, businessId, description: 'Old brand.' }
      throw new api.ApiError(404, 'no profile')
    })
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText('Old brand.')
    await user.click(screen.getByRole('button', { name: 'Add Business' }))
    await user.type(screen.getByLabelText('Name', { selector: '#name' }), 'New Co')
    await user.selectOptions(screen.getByLabelText('Industry'), 'OTHER')
    await user.click(screen.getByRole('button', { name: 'Save Business' }))

    expect(await screen.findByLabelText(/Brand overview/)).toHaveFocus()
    expect(screen.getByLabelText('Business', { exact: true })).toHaveValue('biz-new')
    expect(mockedApi.getBrandProfile).toHaveBeenCalledWith('biz-new')
  })

  it('shows an error if creating a business fails', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    mockedApi.createBusiness.mockRejectedValue(new api.ApiError(422, 'Name is required'))
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    await user.type(screen.getByLabelText('Name'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save Business' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required')
  })

  it('shows "Company Information" as the create-business section heading', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])

    renderDashboard()

    expect(
      await screen.findByRole('heading', { name: 'Company Information' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Create a business' }),
    ).not.toBeInTheDocument()
  })

  it('shows the logo field first, before Name', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    const labels = screen.getAllByText(/^(Logo|Name)$/, { exact: false })
    expect(labels[0]).toHaveTextContent('Logo')
  })

  it('stages a selected logo as a preview thumbnail', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    const logo = new File([new Uint8Array(1024)], 'logo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText(/Logo/), logo)

    expect(await screen.findByAltText('Business logo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove logo' })).toBeInTheDocument()
  })

  it('clears the dragging state on drag-leave without staging anything', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    const dropzone = screen.getByText(/Drag and drop, or click to browse/).closest('label')
    if (!dropzone) throw new Error('dropzone label not found')

    fireEvent.dragOver(dropzone)
    expect(dropzone).toHaveClass('photo-dropzone-active')

    fireEvent.dragLeave(dropzone)

    expect(dropzone).not.toHaveClass('photo-dropzone-active')
    expect(screen.queryByAltText('Business logo')).not.toBeInTheDocument()
  })

  it('shows the identity card (avatar, name, website) once a logo is staged', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    await user.type(screen.getByLabelText('Name'), 'Acme Widgets')
    await user.type(screen.getByLabelText('Website'), 'https://acme.example')

    await user.upload(
      screen.getByLabelText(/Logo/),
      new File([new Uint8Array(1024)], 'logo.png', { type: 'image/png' }),
    )

    expect(await screen.findByAltText('Business logo')).toBeInTheDocument()
    expect(screen.getByText('Acme Widgets')).toBeInTheDocument()
    expect(screen.getByText('https://acme.example')).toBeInTheDocument()
    // The dropzone itself is replaced by the card while a logo is staged
    // — picking a different one goes through "Remove logo" first.
    expect(screen.queryByText('Add logo')).not.toBeInTheDocument()
  })

  it('lets the user remove and re-pick a different logo', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    await user.upload(
      screen.getByLabelText(/Logo/),
      new File([new Uint8Array(1024)], 'first.png', { type: 'image/png' }),
    )
    await screen.findByAltText('Business logo')

    await user.click(screen.getByRole('button', { name: 'Remove logo' }))
    await user.upload(
      screen.getByLabelText(/Logo/),
      new File([new Uint8Array(1024)], 'second.png', { type: 'image/png' }),
    )

    expect(await screen.findAllByAltText('Business logo')).toHaveLength(1)
  })

  it('stages a dragged-and-dropped logo the same way as a browsed one', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    const dropzone = screen.getByText(/Drag and drop, or click to browse/).closest('label')
    if (!dropzone) throw new Error('dropzone label not found')
    const logo = new File([new Uint8Array(1024)], 'logo.png', { type: 'image/png' })

    fireEvent.dragOver(dropzone)
    expect(dropzone).toHaveClass('photo-dropzone-active')

    fireEvent.drop(dropzone, { dataTransfer: { files: [logo] } })

    // The dropzone itself is replaced by the logo card once staged, so
    // there's no "active" class left to check on it — its absence from
    // the document is the real assertion here.
    expect(await screen.findByAltText('Business logo')).toBeInTheDocument()
    expect(dropzone).not.toBeInTheDocument()
  })

  it('rejects an unsupported logo file type without staging it', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    const badFile = new File([new Uint8Array(10)], 'logo.webp', { type: 'image/webp' })

    fireEvent.change(screen.getByLabelText(/Logo/), { target: { files: [badFile] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported image type')
    expect(screen.queryByAltText('Business logo')).not.toBeInTheDocument()
  })

  it('removes a staged logo', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    const logo = new File([new Uint8Array(1024)], 'logo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText(/Logo/), logo)
    await screen.findByAltText('Business logo')

    await user.click(screen.getByRole('button', { name: 'Remove logo' }))

    expect(screen.queryByAltText('Business logo')).not.toBeInTheDocument()
    expect(screen.getByText('Add logo')).toBeInTheDocument()
  })

  it('uploads the staged logo after the business is created', async () => {
    const created: api.Business = {
      id: '1',
      name: 'Acme Widgets',
      website: null,
      industry: 'FASHION_JEWELRY',
      location: null,
      logoUrl: null,
      description: null,
    }
    mockedApi.listBusinesses.mockResolvedValueOnce([]).mockResolvedValue([created])
    mockedApi.createBusiness.mockResolvedValue({
      id: '1',
      name: 'Acme Widgets',
      website: null,
      industry: 'FASHION_JEWELRY',
      location: null,
      logoUrl: null,
      description: null,
    })
    mockedApi.uploadBusinessLogo.mockResolvedValue({
      id: '1',
      name: 'Acme Widgets',
      website: null,
      industry: 'FASHION_JEWELRY',
      location: null,
      logoUrl: 'http://localhost:8000/business-logos/1',
      description: null,
    })
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    const logo = new File([new Uint8Array(1024)], 'logo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText(/Logo/), logo)
    await user.type(screen.getByLabelText('Name'), 'Acme Widgets')
    await user.selectOptions(screen.getByLabelText('Industry'), 'FASHION_JEWELRY')

    await user.click(screen.getByRole('button', { name: 'Save Business' }))

    await waitFor(() => expect(mockedApi.uploadBusinessLogo).toHaveBeenCalledWith('1', logo))
    expect(await screen.findByLabelText(/Brand overview/)).toBeInTheDocument()
  })

  it('does not upload a logo when none was staged', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    mockedApi.createBusiness.mockResolvedValue({
      id: '1',
      name: 'Acme Widgets',
      website: null,
      industry: 'FASHION_JEWELRY',
      location: null,
      logoUrl: null,
      description: null,
    })
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    await user.type(screen.getByLabelText('Name'), 'Acme Widgets')
    await user.selectOptions(screen.getByLabelText('Industry'), 'FASHION_JEWELRY')

    await user.click(screen.getByRole('button', { name: 'Save Business' }))

    await waitFor(() => expect(mockedApi.createBusiness).toHaveBeenCalled())
    expect(mockedApi.uploadBusinessLogo).not.toHaveBeenCalled()
  })

  it('still goes on to the Brand form even if the logo upload fails', async () => {
    const created: api.Business = {
      id: '1',
      name: 'Acme Widgets',
      website: null,
      industry: 'FASHION_JEWELRY',
      location: null,
      logoUrl: null,
      description: null,
    }
    mockedApi.listBusinesses.mockResolvedValueOnce([]).mockResolvedValue([created])
    mockedApi.createBusiness.mockResolvedValue({
      id: '1',
      name: 'Acme Widgets',
      website: null,
      industry: 'FASHION_JEWELRY',
      location: null,
      logoUrl: null,
      description: null,
    })
    mockedApi.uploadBusinessLogo.mockRejectedValue(new api.ApiError(500, 'Upload failed'))
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    const logo = new File([new Uint8Array(1024)], 'logo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText(/Logo/), logo)
    await user.type(screen.getByLabelText('Name'), 'Acme Widgets')
    await user.selectOptions(screen.getByLabelText('Industry'), 'FASHION_JEWELRY')

    await user.click(screen.getByRole('button', { name: 'Save Business' }))

    expect(await screen.findByLabelText(/Brand overview/)).toBeInTheDocument()
  })

  it('renders the industry dropdown as required with every fetched option', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    const select = screen.getByLabelText('Industry')
    expect(select).toBeRequired()
    for (const option of INDUSTRY_OPTIONS) {
      expect(screen.getByRole('option', { name: option.label })).toBeInTheDocument()
    }
  })

  it('shows an error if industry is left unselected', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    mockedApi.createBusiness.mockRejectedValue(
      new api.ApiError(422, 'Industry is required'),
    )
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    await user.type(screen.getByLabelText('Name'), 'Acme Widgets')
    await user.click(screen.getByRole('button', { name: 'Save Business' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Industry is required')
  })

  it('shows a live character counter and caps the description at 1000 characters', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    const description = screen.getByLabelText(/About your business/)
    expect(screen.getByText('0/1000')).toBeInTheDocument()

    await user.type(description, 'Family-run since 1985')

    expect(screen.getByText('21/1000')).toBeInTheDocument()
    expect(description).toHaveAttribute('maxLength', '1000')
  })

  it('logs out when the log out button is clicked', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    mockedApi.logout.mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(mockedApi.logout).toHaveBeenCalled())
  })

  describe('the Next button', () => {
    const biz = (id: string, name: string): api.Business => ({
      id,
      name,
      website: null,
      industry: null,
      location: null,
      logoUrl: null,
      description: null,
    })

    it('is not shown until there is a business to go on to', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])

      renderDashboard()

      await screen.findByText(/No businesses yet/)
      expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    })

    it('is a gold button at the end of the page that opens the business page', async () => {
      mockedApi.listBusinesses.mockResolvedValue([biz('biz-1', 'Acme')])
      const user = userEvent.setup()

      renderDashboard()

      const next = await screen.findByRole('button', { name: 'Next' })
      expect(next).toHaveClass('btn-outline', 'btn-gold')
      expect(next.parentElement).toHaveClass('page-next')
      // Last thing on the page, below every section.
      const main = next.closest('main') as HTMLElement
      expect(main.lastElementChild).toBe(next.parentElement)

      await user.click(next)

      expect(await screen.findByTestId('stub-business-id')).toHaveTextContent('biz-1')
    })

    it('carries on to whichever business the Brand section is showing', async () => {
      mockedApi.listBusinesses.mockResolvedValue([biz('biz-1', 'Acme'), biz('biz-2', 'Zenith')])
      const user = userEvent.setup()
      renderDashboard('/')

      await user.selectOptions(await screen.findByLabelText('Business'), 'biz-2')
      await user.click(screen.getByRole('button', { name: 'Next' }))

      expect(await screen.findByTestId('stub-business-id')).toHaveTextContent('biz-2')
    })
  })

  describe('when the option lists cannot load (for example an iPhone that lost its session)', () => {
    const acme: api.Business = {
      id: 'biz-1',
      name: 'Acme Widgets',
      website: null,
      industry: null,
      location: null,
      logoUrl: null,
      description: null,
    }

    it('keeps the Industry dropdown a native select and says why it is empty, instead of staying silent', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.getOptions.mockRejectedValue(new api.ApiError(401, 'Not authenticated'))
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Add Business' }))

      const industry = screen.getByLabelText('Industry')
      expect(industry.tagName).toBe('SELECT')
      expect(within(industry).getAllByRole('option')).toHaveLength(1)
      // The message sits with the dropdown it explains.
      const field = industry.closest('.field') as HTMLElement
      expect(await within(field).findByRole('alert')).toHaveTextContent(/not signed in/)
    })

    it('fills the Industry list once Try again succeeds', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.getOptions.mockRejectedValueOnce(new api.ApiError(401, 'Not authenticated'))
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Add Business' }))
      const field = screen.getByLabelText('Industry').closest('.field') as HTMLElement
      await user.click(await within(field).findByRole('button', { name: 'Try again' }))

      await waitFor(() =>
        expect(within(screen.getByLabelText('Industry')).getAllByRole('option').length).toBe(
          INDUSTRY_OPTIONS.length + 1,
        ),
      )
      expect(within(field).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    })

    it('says so in the edit form too', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.getOptions.mockRejectedValue(new Error('offline'))
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Edit Business' }))

      const panel = within(await screen.findByRole('region', { name: 'Edit business' }))
      const field = panel.getByLabelText('Industry').closest('.field') as HTMLElement
      expect(await within(field).findByRole('alert')).toHaveTextContent(/Check your connection/)
      expect(panel.getByLabelText('Industry').tagName).toBe('SELECT')
    })

    it('shows no message when the lists load', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Add Business' }))

      await waitFor(() =>
        expect(within(screen.getByLabelText('Industry')).getAllByRole('option').length).toBeGreaterThan(1),
      )
      const field = screen.getByLabelText('Industry').closest('.field') as HTMLElement
      expect(within(field).queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('delete business', () => {
    const acme: api.Business = {
      id: 'biz-1',
      name: 'Acme Widgets',
      website: null,
      industry: null,
      location: null,
      logoUrl: null,
      description: null,
    }
    const globex: api.Business = { ...acme, id: 'biz-2', name: 'Globex' }

    it('puts Delete Business in the same row as Save Business', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Add Business' }))

      const create = screen.getByRole('button', { name: 'Save Business' })
      const del = screen.getByRole('button', { name: 'Delete Business' })
      expect(del.parentElement).toBe(create.parentElement)
    })

    it('says there is nothing to delete when there are no businesses', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText(/No businesses yet/)
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))

      expect(screen.getByText('You have no businesses to delete.')).toBeInTheDocument()
      expect(screen.queryByLabelText('Business to delete')).not.toBeInTheDocument()
    })

    it('preselects the only business and needs its exact name before enabling delete', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.listCampaigns.mockResolvedValue([])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))

      const confirm = await screen.findByRole('button', { name: 'Permanently delete business' })
      expect(confirm).toBeDisabled()
      const nameField = await screen.findByLabelText(/Type/)
      await user.type(nameField, 'wrong name')
      expect(confirm).toBeDisabled()
      await user.clear(nameField)
      await user.type(nameField, 'Acme Widgets')
      expect(confirm).toBeEnabled()
      expect(mockedApi.deleteBusiness).not.toHaveBeenCalled()
    })

    it('picks up a lone business that finishes loading after the panel was opened', async () => {
      let finishLoading: (list: api.Business[]) => void = () => {}
      mockedApi.listBusinesses.mockReturnValue(
        new Promise<api.Business[]>((resolve) => {
          finishLoading = resolve
        }),
      )
      mockedApi.listCampaigns.mockResolvedValue([])
      const user = userEvent.setup()

      renderDashboard()
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))
      expect(screen.getByText('You have no businesses to delete.')).toBeInTheDocument()

      finishLoading([acme])

      expect(await screen.findByLabelText(/Type/)).toBeInTheDocument()
      expect(screen.queryByText('You have no businesses to delete.')).not.toBeInTheDocument()
    })

    it('asks which business when there are several, then deletes it and refreshes the list', async () => {
      mockedApi.listBusinesses
        .mockResolvedValueOnce([acme, globex])
        .mockResolvedValueOnce([acme])
      mockedApi.listCampaigns.mockResolvedValue([])
      mockedApi.deleteBusiness.mockResolvedValue(undefined)
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByRole('link', { name: 'Globex' })
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))
      // Nothing to confirm until one is picked.
      expect(screen.queryByLabelText(/Type/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Permanently delete business' })).toBeDisabled()

      await user.selectOptions(screen.getByLabelText('Business to delete'), 'biz-2')
      await user.type(await screen.findByLabelText(/Type/), 'Globex')
      await user.click(screen.getByRole('button', { name: 'Permanently delete business' }))

      await waitFor(() => expect(mockedApi.deleteBusiness).toHaveBeenCalledWith('biz-2'))
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Globex' })).not.toBeInTheDocument())
      expect(screen.getByText('Acme Widgets')).toBeInTheDocument()
      // Panel closed again.
      expect(
        screen.queryByRole('button', { name: 'Permanently delete business' }),
      ).not.toBeInTheDocument()
    })

    it('shows the 409 message and keeps the business when a campaign is live', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.listCampaigns.mockResolvedValue([])
      mockedApi.deleteBusiness.mockRejectedValue(
        new api.ApiError(409, 'Pause or end it before deleting this business.'),
      )
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))
      await user.type(await screen.findByLabelText(/Type/), 'Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Permanently delete business' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Pause or end it before deleting this business.',
      )
      expect(screen.getByRole('link', { name: 'Acme Widgets' })).toBeInTheDocument()
    })

    it('falls back to a generic message when the delete fails unexpectedly', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.listCampaigns.mockResolvedValue([])
      mockedApi.deleteBusiness.mockRejectedValue(new Error('boom'))
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))
      await user.type(await screen.findByLabelText(/Type/), 'Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Permanently delete business' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete business.')
    })

    it('notes that Meta campaigns remain paused only when one was ever published', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme, globex])
      mockedApi.listCampaigns.mockImplementation(async (id) =>
        id === 'biz-1' ? [{ metaCampaignId: 'meta-1' } as api.Campaign] : [],
      )
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByRole('link', { name: 'Globex' })
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))

      await user.selectOptions(screen.getByLabelText('Business to delete'), 'biz-1')
      expect(
        await screen.findByText(/they'll remain \(paused\) in your Meta account/),
      ).toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText('Business to delete'), 'biz-2')
      await screen.findByLabelText(/Type/)
      expect(screen.queryByText(/remain \(paused\)/)).not.toBeInTheDocument()
    })

    it('still works when the campaign lookup fails, and cancel closes the panel', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.listCampaigns.mockRejectedValue(new Error('offline'))
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))
      await screen.findByLabelText(/Type/)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(
        screen.queryByRole('button', { name: 'Permanently delete business' }),
      ).not.toBeInTheDocument()
      expect(mockedApi.deleteBusiness).not.toHaveBeenCalled()
    })
  })

  describe('edit business', () => {
    const acme: api.Business = {
      id: 'biz-1',
      name: 'Acme Widgets',
      website: null,
      industry: null,
      location: null,
      logoUrl: null,
      description: null,
    }
    const globex: api.Business = { ...acme, id: 'biz-2', name: 'Globex' }

    async function openEditPanel(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: 'Edit Business' }))
      return within(await screen.findByRole('region', { name: 'Edit business' }))
    }

    it('puts Delete Business immediately to the right of Edit Business, after Save Business', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Add Business' }))

      const save = screen.getByRole('button', { name: 'Save Business' })
      const edit = screen.getByRole('button', { name: 'Edit Business' })
      const del = screen.getByRole('button', { name: 'Delete Business' })
      expect(edit.parentElement).toBe(del.parentElement)
      expect(save.nextElementSibling).toBe(edit)
      expect(edit.nextElementSibling).toBe(del)
    })

    it('styles Edit as a neutral outline and Delete as a red outline, each with an icon first', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])

      renderDashboard()
      await screen.findByText('Acme Widgets')

      const edit = screen.getByRole('button', { name: 'Edit Business' })
      const del = screen.getByRole('button', { name: 'Delete Business' })
      expect(edit).toHaveClass('btn-outline')
      expect(edit).not.toHaveClass('btn-outline-danger')
      expect(del).toHaveClass('btn-outline', 'btn-outline-danger')
      for (const button of [edit, del]) {
        expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg')
        expect(button.firstElementChild).toHaveAttribute('aria-hidden', 'true')
      }
    })

    it('styles Save Business as the same outlined button shape in gold, with a save icon first', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Add Business' }))

      const save = screen.getByRole('button', { name: 'Save Business' })
      const edit = screen.getByRole('button', { name: 'Edit Business' })
      expect(save).toHaveClass('btn-outline', 'btn-gold')
      expect(save.firstElementChild?.tagName.toLowerCase()).toBe('svg')
      expect(save.firstElementChild).toHaveAttribute('aria-hidden', 'true')
      // Same icon box as the Edit button's.
      expect(save.firstElementChild?.getAttribute('width')).toBe(
        edit.firstElementChild?.getAttribute('width'),
      )
    })

    it('shows Saving… and disables Save Business while a business is being created', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])
      mockedApi.createBusiness.mockReturnValue(new Promise(() => {}))
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText(/No businesses yet/)
      await user.type(screen.getByLabelText('Name'), 'Acme')
      await user.selectOptions(screen.getByLabelText('Industry'), 'OTHER')
      await user.click(screen.getByRole('button', { name: 'Save Business' }))

      const saving = await screen.findByRole('button', { name: 'Saving…' })
      expect(saving).toBeDisabled()
      expect(saving).toHaveClass('btn-gold')
    })

    it('styles the edit panel\'s Save in gold with the save icon, and its Cancel as text-link styling', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Edit Business' }))

      const panel = within(await screen.findByRole('region', { name: 'Edit business' }))
      const save = panel.getByRole('button', { name: 'Save' })
      const cancel = panel.getByRole('button', { name: 'Cancel' })
      expect(save).toHaveClass('btn-outline', 'btn-gold')
      expect(save.firstElementChild?.tagName.toLowerCase()).toBe('svg')
      expect(save.firstElementChild).toHaveAttribute('aria-hidden', 'true')
      // Cancel is understated underlined text, with no icon or button shape.
      expect(cancel).toHaveClass('cancel-link')
      expect(cancel).not.toHaveClass('btn-outline')
      expect(cancel.querySelector('svg')).toBeNull()
      // Save and Cancel share one row.
      expect(save.parentElement).toBe(cancel.parentElement)
    })

    it('toggles the edit panel: a second click on Edit Business closes it', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const edit = screen.getByRole('button', { name: 'Edit Business' })
      expect(edit).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region', { name: 'Edit business' })).not.toBeInTheDocument()

      await user.click(edit)
      expect(edit).toHaveAttribute('aria-expanded', 'true')
      expect(edit).toHaveAttribute('aria-controls', 'edit-business-panel')
      expect(await screen.findByRole('region', { name: 'Edit business' })).toHaveAttribute(
        'id',
        'edit-business-panel',
      )

      await user.click(edit)
      expect(edit).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region', { name: 'Edit business' })).not.toBeInTheDocument()

      await user.click(edit)
      expect(await screen.findByRole('region', { name: 'Edit business' })).toBeInTheDocument()
    })

    it('starts the edit panel fresh after it was closed with the toggle', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme, globex])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByRole('link', { name: 'Acme Widgets' })
      const edit = screen.getByRole('button', { name: 'Edit Business' })
      await user.click(edit)
      await user.selectOptions(await screen.findByLabelText('Business to edit'), 'biz-2')
      expect(screen.getByLabelText('Name', { selector: '#business-name' })).toHaveValue('Globex')

      await user.click(edit)
      await user.click(edit)

      // Back to the picker with nothing chosen, as after Cancel.
      expect(await screen.findByLabelText('Business to edit')).toHaveValue('')
    })

    it('keeps Edit and Delete side by side even while the Edit panel is open', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Edit Business' }))

      const edit = screen.getByRole('button', { name: 'Edit Business' })
      const del = screen.getByRole('button', { name: 'Delete Business' })
      // The panel is its own full-width item in the same row; the stylesheet
      // orders it after both buttons (checked in the browser, jsdom has no CSS).
      const panel = screen.getByRole('region', { name: 'Edit business' })
      expect(panel).toHaveClass('edit-business-panel')
      expect(panel.parentElement).toBe(edit.parentElement)
      expect(del.parentElement).toBe(edit.parentElement)
    })

    it('shows the delete confirmation with a neutral Cancel and a red delete button', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.listCampaigns.mockResolvedValue([])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))

      expect(screen.getByRole('button', { name: 'Permanently delete business' })).toHaveClass(
        'btn-danger',
      )
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('cancel-link')
      expect(screen.getByText(/This will remove "Acme Widgets"/)).toBeInTheDocument()
    })

    it('says there is nothing to edit when there are no businesses', async () => {
      mockedApi.listBusinesses.mockResolvedValue([])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText(/No businesses yet/)
      const panel = await openEditPanel(user)

      expect(panel.getByText('You have no businesses to edit.')).toBeInTheDocument()
      await user.click(panel.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('region', { name: 'Edit business' })).not.toBeInTheDocument()
    })

    it('preselects the only business and saves an edit, then refreshes the list', async () => {
      mockedApi.listBusinesses
        .mockResolvedValueOnce([acme])
        .mockResolvedValueOnce([{ ...acme, name: 'Acme Inc' }])
      mockedApi.updateBusiness.mockResolvedValue({ ...acme, name: 'Acme Inc' })
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const panel = await openEditPanel(user)

      const nameField = await panel.findByLabelText('Name')
      expect(nameField).toHaveValue('Acme Widgets')
      await user.clear(nameField)
      await user.type(nameField, 'Acme Inc')
      await user.type(panel.getByLabelText(/About your business/), 'Family-run since 1985')
      await user.click(panel.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(mockedApi.updateBusiness).toHaveBeenCalledWith('biz-1', {
          name: 'Acme Inc',
          website: null,
          location: null,
          description: 'Family-run since 1985',
        }),
      )
      expect(await screen.findByRole('link', { name: 'Acme Inc' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Edit business' })).not.toBeInTheDocument()
    })

    it('does not also try to create a business when an edit is saved', async () => {
      mockedApi.listBusinesses
        .mockResolvedValueOnce([acme])
        .mockResolvedValueOnce([{ ...acme, name: 'Acme Inc' }])
      mockedApi.updateBusiness.mockResolvedValue({ ...acme, name: 'Acme Inc' })
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByRole('link', { name: 'Acme Widgets' })
      // Something typed into the Add Business form must not be submitted by an edit.
      await user.click(screen.getByRole('button', { name: 'Add Business' }))
      await user.type(screen.getByLabelText('Name', { selector: '#name' }), 'Half-typed business')
      const panel = await openEditPanel(user)
      await user.click(await panel.findByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockedApi.updateBusiness).toHaveBeenCalled())
      expect(mockedApi.createBusiness).not.toHaveBeenCalled()
    })

    it('asks which business when there are several and edits the one picked', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme, globex])
      mockedApi.updateBusiness.mockResolvedValue({ ...globex, industry: 'FASHION_JEWELRY' })
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByRole('link', { name: 'Globex' })
      const panel = await openEditPanel(user)
      // No form until one is picked.
      expect(panel.queryByLabelText('Name')).not.toBeInTheDocument()

      await user.selectOptions(panel.getByLabelText('Business to edit'), 'biz-2')
      const select = await panel.findByLabelText('Industry')
      expect(select).toBeRequired()
      for (const option of INDUSTRY_OPTIONS) {
        expect(panel.getByRole('option', { name: option.label })).toBeInTheDocument()
      }
      await user.selectOptions(select, 'FASHION_JEWELRY')
      await user.click(panel.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(mockedApi.updateBusiness).toHaveBeenCalledWith('biz-2', {
          name: 'Globex',
          website: null,
          industry: 'FASHION_JEWELRY',
          location: null,
          description: null,
        }),
      )
    })

    it('picks up a lone business that finishes loading after the panel was opened', async () => {
      let finishLoading: (list: api.Business[]) => void = () => {}
      mockedApi.listBusinesses.mockReturnValue(
        new Promise<api.Business[]>((resolve) => {
          finishLoading = resolve
        }),
      )
      const user = userEvent.setup()

      renderDashboard()
      const panel = await openEditPanel(user)
      expect(panel.getByText('You have no businesses to edit.')).toBeInTheDocument()

      finishLoading([acme])

      expect(await panel.findByLabelText('Name')).toHaveValue('Acme Widgets')
    })

    it('edits website and location', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.updateBusiness.mockResolvedValue({
        ...acme,
        website: 'https://acme.example',
        location: 'CDMX',
      })
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const panel = await openEditPanel(user)
      await user.type(await panel.findByLabelText('Website'), 'https://acme.example')
      await user.type(panel.getByLabelText('Location'), 'CDMX')
      await user.click(panel.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(mockedApi.updateBusiness).toHaveBeenCalledWith('biz-1', {
          name: 'Acme Widgets',
          website: 'https://acme.example',
          location: 'CDMX',
          description: null,
        }),
      )
    })

    it('uploads a new logo on save', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.updateBusiness.mockResolvedValue(acme)
      mockedApi.uploadBusinessLogo.mockResolvedValue({
        ...acme,
        logoUrl: 'https://backend.example/business-logos/biz-1',
      })
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const panel = await openEditPanel(user)
      await panel.findByLabelText('Name')
      const file = new File(['logo-bytes'], 'logo.png', { type: 'image/png' })
      await user.upload(document.getElementById('business-logo') as HTMLInputElement, file)
      await user.click(panel.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(mockedApi.uploadBusinessLogo).toHaveBeenCalledWith('biz-1', file),
      )
    })

    it('rejects an oversized logo file', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const panel = await openEditPanel(user)
      await panel.findByLabelText('Name')
      const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'logo.png', {
        type: 'image/png',
      })
      await user.upload(document.getElementById('business-logo') as HTMLInputElement, oversized)

      expect(await panel.findByRole('alert')).toHaveTextContent(/exceeds the 8MB limit/i)
      expect(mockedApi.uploadBusinessLogo).not.toHaveBeenCalled()
    })

    it('stages a dropped logo file', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const panel = await openEditPanel(user)
      await panel.findByLabelText('Name')
      const dropzone = panel.getByText('Add logo').closest('label') as HTMLLabelElement
      const file = new File(['logo-bytes'], 'logo.png', { type: 'image/png' })

      fireEvent.dragOver(dropzone, { dataTransfer: { files: [file] } })
      fireEvent.dragLeave(dropzone)
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

      expect(await panel.findByAltText('Business logo')).toBeInTheDocument()
    })

    it('replaces an already-saved logo via the change-logo button', async () => {
      mockedApi.listBusinesses.mockResolvedValue([
        { ...acme, logoUrl: 'https://backend.example/business-logos/biz-1' },
      ])
      mockedApi.updateBusiness.mockResolvedValue(acme)
      mockedApi.uploadBusinessLogo.mockResolvedValue(acme)
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const panel = await openEditPanel(user)
      await user.click(await panel.findByRole('button', { name: 'Change logo' }))
      const file = new File(['logo-bytes-2'], 'logo2.png', { type: 'image/png' })
      await user.upload(document.getElementById('business-logo') as HTMLInputElement, file)
      await user.click(panel.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(mockedApi.uploadBusinessLogo).toHaveBeenCalledWith('biz-1', file),
      )
    })

    it('cancels an edit without saving', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const panel = await openEditPanel(user)
      await user.type(await panel.findByLabelText('Name'), ' extra text')
      await user.click(panel.getByRole('button', { name: 'Cancel' }))

      expect(mockedApi.updateBusiness).not.toHaveBeenCalled()
      expect(screen.queryByRole('region', { name: 'Edit business' })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Acme Widgets' })).toBeInTheDocument()
    })

    it('cancels from the picker before a business is chosen', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme, globex])
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByRole('link', { name: 'Globex' })
      const panel = await openEditPanel(user)
      await user.click(panel.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('region', { name: 'Edit business' })).not.toBeInTheDocument()
    })

    it('surfaces a backend error inline on the edit form', async () => {
      mockedApi.listBusinesses.mockResolvedValue([acme])
      mockedApi.updateBusiness.mockRejectedValue(new api.ApiError(422, 'Name is required'))
      const user = userEvent.setup()

      renderDashboard()
      await screen.findByText('Acme Widgets')
      const panel = await openEditPanel(user)
      await panel.findByLabelText('Name')
      await user.click(panel.getByRole('button', { name: 'Save' }))

      expect(await panel.findByRole('alert')).toHaveTextContent('Name is required')
    })
  })
})
