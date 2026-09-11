import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'
import { AuthProvider } from '../context/AuthContext'
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
  mockedApi.getMe.mockResolvedValue({ id: '1', email: 'owner@example.com' })
  mockedApi.getOptions.mockResolvedValue({
    industries: INDUSTRY_OPTIONS,
    objectives: [],
    campaignStatuses: [],
    ctas: [],
    actionTypes: [],
    eventVenues: [],
  })
})

function renderDashboard() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/businesses/:businessId" element={<p>Business detail page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
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
    // The friendly label, not the raw enum value — from the fetched
    // industries list, not hard-coded. Matched with the "— " prefix to
    // disambiguate from the same label inside the create-form's <option>.
    expect(await screen.findByText(/— Fashion \/ Jewelry/)).toBeInTheDocument()
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

  it('creates a business and navigates straight to its detail page', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    mockedApi.createBusiness.mockResolvedValue({
      id: '1',
      name: 'Acme Widgets',
      website: null,
      industry: null,
      location: null,
      logoUrl: null,
      description: null,
    })
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    await user.type(screen.getByLabelText('Name'), 'Acme Widgets')
    await user.type(screen.getByLabelText('Website'), 'https://acme.example')
    await user.selectOptions(screen.getByLabelText('Industry'), 'FASHION_JEWELRY')
    await user.type(screen.getByLabelText('Location'), 'CDMX')
    await user.type(screen.getByLabelText(/About your business/), 'We make widgets.')
    await user.click(screen.getByRole('button', { name: 'Create business' }))

    await waitFor(() =>
      expect(mockedApi.createBusiness).toHaveBeenCalledWith({
        name: 'Acme Widgets',
        website: 'https://acme.example',
        industry: 'FASHION_JEWELRY',
        location: 'CDMX',
        description: 'We make widgets.',
      }),
    )
    // Lands on the new business's own page — not left behind on a
    // cleared, dead-end create-business form.
    expect(await screen.findByText('Business detail page')).toBeInTheDocument()
  })

  it('shows an error if creating a business fails', async () => {
    mockedApi.listBusinesses.mockResolvedValue([])
    mockedApi.createBusiness.mockRejectedValue(new api.ApiError(422, 'Name is required'))
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)

    await user.type(screen.getByLabelText('Name'), 'x')
    await user.click(screen.getByRole('button', { name: 'Create business' }))

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

    await user.click(screen.getByRole('button', { name: 'Create business' }))

    await waitFor(() => expect(mockedApi.uploadBusinessLogo).toHaveBeenCalledWith('1', logo))
    expect(await screen.findByText('Business detail page')).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Create business' }))

    await waitFor(() => expect(mockedApi.createBusiness).toHaveBeenCalled())
    expect(mockedApi.uploadBusinessLogo).not.toHaveBeenCalled()
  })

  it('still navigates to the new business even if the logo upload fails', async () => {
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
    mockedApi.uploadBusinessLogo.mockRejectedValue(new api.ApiError(500, 'Upload failed'))
    const user = userEvent.setup()

    renderDashboard()
    await screen.findByText(/No businesses yet/)
    const logo = new File([new Uint8Array(1024)], 'logo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText(/Logo/), logo)
    await user.type(screen.getByLabelText('Name'), 'Acme Widgets')
    await user.selectOptions(screen.getByLabelText('Industry'), 'FASHION_JEWELRY')

    await user.click(screen.getByRole('button', { name: 'Create business' }))

    expect(await screen.findByText('Business detail page')).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Create business' }))

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
})
