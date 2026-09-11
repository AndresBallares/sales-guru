import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandProfileForm } from './BrandProfileForm'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
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
  voiceTraits: [
    { value: 'WARM', label: 'Warm' },
    { value: 'ARTISANAL', label: 'Artisanal' },
    { value: 'BOLD', label: 'Bold' },
  ],
  pricePositionings: [
    { value: 'PREMIUM', label: 'Premium' },
    { value: 'LUXURY', label: 'Luxury' },
  ],
}

const profile: api.BrandProfile = {
  id: 'brand-1',
  businessId: 'biz-1',
  description: 'Family-run studio making handcrafted gold jewelry.',
  idealCustomer: 'Women 30-55 buying for milestones.',
  voiceTraits: ['WARM', 'ARTISANAL'],
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

describe('BrandProfileForm — create mode', () => {
  it('creates a brand profile with the required fields', async () => {
    mockedApi.createBrandProfile.mockResolvedValue(profile)
    const onSaved = vi.fn<(profile: api.BrandProfile) => void>()
    const user = userEvent.setup()
    render(<BrandProfileForm businessId="biz-1" onSaved={onSaved} />)
    await screen.findByLabelText('Warm')

    await user.type(
      screen.getByLabelText(/Brand overview/),
      'Family-run studio making handcrafted gold jewelry.',
    )
    await user.type(
      screen.getByLabelText('Ideal customer'),
      'Women 30-55 buying for milestones.',
    )
    await user.click(screen.getByLabelText('Warm'))
    await user.click(screen.getByLabelText('Artisanal'))
    await user.selectOptions(screen.getByLabelText('Price positioning'), 'PREMIUM')
    await user.click(screen.getByRole('button', { name: 'Save brand profile' }))

    await waitFor(() =>
      expect(mockedApi.createBrandProfile).toHaveBeenCalledWith('biz-1', {
        description: 'Family-run studio making handcrafted gold jewelry.',
        idealCustomer: 'Women 30-55 buying for milestones.',
        voiceTraits: ['WARM', 'ARTISANAL'],
        pricePositioning: 'PREMIUM',
        brandPhrases: undefined,
        avoidPhrases: undefined,
        tagline: undefined,
        competitors: undefined,
        exampleCopy: undefined,
      }),
    )
    expect(onSaved).toHaveBeenCalledWith(profile)
  })

  it('toggles a voice trait off when clicked again', async () => {
    mockedApi.createBrandProfile.mockResolvedValue(profile)
    const user = userEvent.setup()
    render(<BrandProfileForm businessId="biz-1" onSaved={vi.fn<(profile: api.BrandProfile) => void>()} />)
    await screen.findByLabelText('Warm')

    await user.click(screen.getByLabelText('Warm'))
    await user.click(screen.getByLabelText('Bold'))
    await user.click(screen.getByLabelText('Warm'))
    await user.type(screen.getByLabelText(/Brand overview/), 'Overview')
    await user.type(screen.getByLabelText('Ideal customer'), 'Customer')
    await user.selectOptions(screen.getByLabelText('Price positioning'), 'LUXURY')
    await user.click(screen.getByRole('button', { name: 'Save brand profile' }))

    await waitFor(() =>
      expect(mockedApi.createBrandProfile).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({ voiceTraits: ['BOLD'] }),
      ),
    )
  })

  it('requires the brand overview field', async () => {
    render(<BrandProfileForm businessId="biz-1" onSaved={vi.fn<(profile: api.BrandProfile) => void>()} />)
    await screen.findByLabelText('Warm')

    expect(screen.getByLabelText(/Brand overview/)).toBeRequired()
    expect(screen.getByLabelText('Ideal customer')).toBeRequired()
    expect(screen.getByLabelText('Price positioning')).toBeRequired()
  })

  it('includes optional fields when filled in', async () => {
    mockedApi.createBrandProfile.mockResolvedValue(profile)
    const user = userEvent.setup()
    render(<BrandProfileForm businessId="biz-1" onSaved={vi.fn<(profile: api.BrandProfile) => void>()} />)
    await screen.findByLabelText('Warm')

    await user.type(screen.getByLabelText(/Brand overview/), 'Overview')
    await user.type(screen.getByLabelText('Ideal customer'), 'Customer')
    await user.click(screen.getByLabelText('Warm'))
    await user.selectOptions(screen.getByLabelText('Price positioning'), 'PREMIUM')
    await user.type(
      screen.getByLabelText(/Brand phrases/),
      'handcrafted, one-of-a-kind',
    )
    await user.type(screen.getByLabelText(/Avoid phrases/), 'cheap, discount')
    await user.type(screen.getByLabelText('Tagline'), 'Wear your story')
    await user.type(screen.getByLabelText('Competitors'), 'Big-box chains')
    await user.type(
      screen.getByLabelText(/Example of on-brand copy/),
      'No two pieces feel the same.',
    )
    await user.click(screen.getByRole('button', { name: 'Save brand profile' }))

    await waitFor(() =>
      expect(mockedApi.createBrandProfile).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({
          brandPhrases: 'handcrafted, one-of-a-kind',
          avoidPhrases: 'cheap, discount',
          tagline: 'Wear your story',
          competitors: 'Big-box chains',
          exampleCopy: 'No two pieces feel the same.',
        }),
      ),
    )
  })

  it('shows an error if creation fails', async () => {
    mockedApi.createBrandProfile.mockRejectedValue(
      new api.ApiError(422, 'At least one voice trait is required'),
    )
    const user = userEvent.setup()
    render(<BrandProfileForm businessId="biz-1" onSaved={vi.fn<(profile: api.BrandProfile) => void>()} />)
    await screen.findByLabelText('Warm')

    await user.type(screen.getByLabelText(/Brand overview/), 'Overview')
    await user.type(screen.getByLabelText('Ideal customer'), 'Customer')
    await user.click(screen.getByLabelText('Warm'))
    await user.selectOptions(screen.getByLabelText('Price positioning'), 'PREMIUM')
    await user.click(screen.getByRole('button', { name: 'Save brand profile' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'At least one voice trait is required',
    )
  })

  it('caps each field at its backend max length and shows a live character count', async () => {
    render(<BrandProfileForm businessId="biz-1" onSaved={vi.fn<(profile: api.BrandProfile) => void>()} />)
    await screen.findByLabelText('Warm')

    expect(screen.getByLabelText(/Brand overview/)).toHaveAttribute('maxLength', '1000')
    expect(screen.getByLabelText('Ideal customer')).toHaveAttribute('maxLength', '1000')
    expect(screen.getByLabelText(/Brand phrases/)).toHaveAttribute('maxLength', '750')
    expect(screen.getByLabelText(/Avoid phrases/)).toHaveAttribute('maxLength', '750')
    expect(screen.getByLabelText('Tagline')).toHaveAttribute('maxLength', '150')
    expect(screen.getByLabelText('Competitors')).toHaveAttribute('maxLength', '1000')
    expect(screen.getByLabelText(/Example of on-brand copy/)).toHaveAttribute(
      'maxLength',
      '2000',
    )
    // description, idealCustomer, and competitors all cap at 1000 — three
    // identical "0 / 1000" counters is the expected starting state.
    expect(screen.getAllByText('0 / 1000')).toHaveLength(3)
    expect(screen.getAllByText('0 / 750')).toHaveLength(2)
    expect(screen.getByText('0 / 2000')).toBeInTheDocument()
  })

  it('updates the character counter as the user types', async () => {
    const user = userEvent.setup()
    render(<BrandProfileForm businessId="biz-1" onSaved={vi.fn<(profile: api.BrandProfile) => void>()} />)
    await screen.findByLabelText('Warm')

    await user.type(screen.getByLabelText('Ideal customer'), 'Women 30-55')

    expect(screen.getByText('11 / 1000')).toBeInTheDocument()
  })

  it('falls back to a generic message for a non-ApiError failure', async () => {
    mockedApi.createBrandProfile.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()
    render(<BrandProfileForm businessId="biz-1" onSaved={vi.fn<(profile: api.BrandProfile) => void>()} />)
    await screen.findByLabelText('Warm')

    await user.type(screen.getByLabelText(/Brand overview/), 'Overview')
    await user.type(screen.getByLabelText('Ideal customer'), 'Customer')
    await user.click(screen.getByLabelText('Warm'))
    await user.selectOptions(screen.getByLabelText('Price positioning'), 'PREMIUM')
    await user.click(screen.getByRole('button', { name: 'Save brand profile' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not create brand profile.',
    )
  })
})

describe('BrandProfileForm — edit mode', () => {
  it('pre-fills every field from the existing profile', async () => {
    render(<BrandProfileForm businessId="biz-1" profile={profile} onSaved={vi.fn<(profile: api.BrandProfile) => void>()} />)
    await screen.findByLabelText('Warm')

    expect(screen.getByLabelText(/Brand overview/)).toHaveValue(profile.description)
    expect(screen.getByLabelText('Ideal customer')).toHaveValue(profile.idealCustomer)
    expect(screen.getByLabelText('Warm')).toBeChecked()
    expect(screen.getByLabelText('Artisanal')).toBeChecked()
    expect(screen.getByLabelText('Bold')).not.toBeChecked()
    expect(screen.getByLabelText('Price positioning')).toHaveValue('PREMIUM')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('updates the profile via PATCH, only sending the current field values', async () => {
    const updated = { ...profile, tagline: 'Wear your story' }
    mockedApi.updateBrandProfile.mockResolvedValue(updated)
    const onSaved = vi.fn<(profile: api.BrandProfile) => void>()
    const user = userEvent.setup()
    render(<BrandProfileForm businessId="biz-1" profile={profile} onSaved={onSaved} />)
    await screen.findByLabelText('Warm')

    await user.type(screen.getByLabelText('Tagline'), 'Wear your story')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockedApi.updateBrandProfile).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({ tagline: 'Wear your story' }),
      ),
    )
    expect(onSaved).toHaveBeenCalledWith(updated)
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn<() => void>()
    const user = userEvent.setup()
    render(
      <BrandProfileForm
        businessId="biz-1"
        profile={profile}
        onSaved={vi.fn<(profile: api.BrandProfile) => void>()}
        onCancel={onCancel}
      />,
    )
    await screen.findByLabelText('Warm')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalled()
  })
})
