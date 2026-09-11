import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandProfileSection } from './BrandProfileSection'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getBrandProfile: vi.fn<typeof actual.getBrandProfile>(),
    createBrandProfile: vi.fn<typeof actual.createBrandProfile>(),
    updateBrandProfile: vi.fn<typeof actual.updateBrandProfile>(),
    getOptions: vi.fn<typeof actual.getOptions>(),
  }
})
const mockedApi = vi.mocked(api)

const ALL_OPTIONS: api.OptionsResponse = {
  industries: [],
  objectives: [],
  campaignStatuses: [],
  ctas: [],
  actionTypes: [],
  eventVenues: [],
  voiceTraits: [{ value: 'WARM', label: 'Warm' }],
  pricePositionings: [{ value: 'PREMIUM', label: 'Premium' }],
}

const profile: api.BrandProfile = {
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
  logoUrl: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.getOptions.mockResolvedValue(ALL_OPTIONS)
})

describe('BrandProfileSection', () => {
  it('shows the onboarding form when no profile exists yet', async () => {
    mockedApi.getBrandProfile.mockRejectedValue(
      new api.ApiError(404, 'This business has no brand profile yet'),
    )

    render(<BrandProfileSection businessId="biz-1" />)

    expect(
      await screen.findByRole('button', { name: 'Save brand profile' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Edit brand profile')).not.toBeInTheDocument()
  })

  it('shows a summary with an edit button once a profile exists', async () => {
    mockedApi.getBrandProfile.mockResolvedValue(profile)

    render(<BrandProfileSection businessId="biz-1" />)

    expect(await screen.findByText(profile.description)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit brand profile' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Save brand profile' }),
    ).not.toBeInTheDocument()
  })

  it('calls onProfileChange with null when none exists', async () => {
    mockedApi.getBrandProfile.mockRejectedValue(
      new api.ApiError(404, 'This business has no brand profile yet'),
    )
    const onProfileChange = vi.fn<(profile: api.BrandProfile | null) => void>()

    render(<BrandProfileSection businessId="biz-1" onProfileChange={onProfileChange} />)

    await waitFor(() => expect(onProfileChange).toHaveBeenCalledWith(null))
  })

  it('calls onProfileChange with the profile once loaded', async () => {
    mockedApi.getBrandProfile.mockResolvedValue(profile)
    const onProfileChange = vi.fn<(profile: api.BrandProfile | null) => void>()

    render(<BrandProfileSection businessId="biz-1" onProfileChange={onProfileChange} />)

    await waitFor(() => expect(onProfileChange).toHaveBeenCalledWith(profile))
  })

  it('shows an error for a non-404 failure', async () => {
    mockedApi.getBrandProfile.mockRejectedValue(new api.ApiError(500, 'Server error'))

    render(<BrandProfileSection businessId="biz-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('switches to edit mode and back, saving through updateBrandProfile', async () => {
    mockedApi.getBrandProfile.mockResolvedValue(profile)
    const updated = { ...profile, tagline: 'Wear your story' }
    mockedApi.updateBrandProfile.mockResolvedValue(updated)
    const user = userEvent.setup()

    render(<BrandProfileSection businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'Edit brand profile' }))
    await screen.findByLabelText('Warm')

    await user.type(screen.getByLabelText('Tagline'), 'Wear your story')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('button', { name: 'Edit brand profile' })).toBeInTheDocument()
    expect(mockedApi.updateBrandProfile).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ tagline: 'Wear your story' }),
    )
  })

  it('cancels out of edit mode back to the summary', async () => {
    mockedApi.getBrandProfile.mockResolvedValue(profile)
    const user = userEvent.setup()

    render(<BrandProfileSection businessId="biz-1" />)
    await user.click(await screen.findByRole('button', { name: 'Edit brand profile' }))
    await screen.findByLabelText('Warm')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(
      await screen.findByRole('button', { name: 'Edit brand profile' }),
    ).toBeInTheDocument()
    expect(mockedApi.updateBrandProfile).not.toHaveBeenCalled()
  })
})
