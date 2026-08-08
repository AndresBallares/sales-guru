import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudiencesSection } from './AudiencesSection'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    createAudience: vi.fn<typeof actual.createAudience>(),
    listAudiences: vi.fn<typeof actual.listAudiences>(),
  }
})
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('AudiencesSection', () => {
  it('shows the audiences for a business', async () => {
    mockedApi.listAudiences.mockResolvedValue([
      {
        id: 'aud-1',
        description: 'Busy parents',
        ageMin: 30,
        ageMax: 55,
        location: null,
        interests: null,
        problem: null,
        desire: null,
      },
    ])

    render(<AudiencesSection businessId="biz-1" />)

    expect(await screen.findByText('Busy parents')).toBeInTheDocument()
  })

  it('shows an empty state when there are no audiences', async () => {
    mockedApi.listAudiences.mockResolvedValue([])

    render(<AudiencesSection businessId="biz-1" />)

    expect(await screen.findByText(/No audiences yet/)).toBeInTheDocument()
  })

  it('shows an error if the audience list fails to load', async () => {
    mockedApi.listAudiences.mockRejectedValue(new api.ApiError(500, 'Server error'))

    render(<AudiencesSection businessId="biz-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error')
  })

  it('creates an audience and refreshes the list', async () => {
    mockedApi.listAudiences
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'aud-1',
          description: 'Busy parents',
          ageMin: null,
          ageMax: null,
          location: null,
          interests: null,
          problem: null,
          desire: null,
        },
      ])
    mockedApi.createAudience.mockResolvedValue({
      id: 'aud-1',
      description: 'Busy parents',
      ageMin: null,
      ageMax: null,
      location: null,
      interests: null,
      problem: null,
      desire: null,
    })
    const user = userEvent.setup()

    render(<AudiencesSection businessId="biz-1" />)
    await screen.findByText(/No audiences yet/)

    await user.type(screen.getByLabelText('Who buys?'), 'Busy parents')
    await user.type(screen.getByLabelText('Location'), 'New York')
    await user.type(screen.getByLabelText('Interests'), 'meal kits')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))

    await waitFor(() =>
      expect(mockedApi.createAudience).toHaveBeenCalledWith('biz-1', {
        description: 'Busy parents',
        ageMin: undefined,
        ageMax: undefined,
        location: 'New York',
        interests: 'meal kits',
        problem: undefined,
        desire: undefined,
      }),
    )
    expect(await screen.findByText('Busy parents')).toBeInTheDocument()
  })

  it('converts numeric fields and shows an error if creation fails', async () => {
    mockedApi.listAudiences.mockResolvedValue([])
    mockedApi.createAudience.mockRejectedValue(new api.ApiError(422, 'Invalid age range'))
    const user = userEvent.setup()

    render(<AudiencesSection businessId="biz-1" />)
    await screen.findByText(/No audiences yet/)

    await user.type(screen.getByLabelText('Who buys?'), 'Busy parents')
    await user.type(screen.getByLabelText('Age min'), '30')
    await user.type(screen.getByLabelText('Age max'), '55')
    await user.type(screen.getByLabelText('Problem'), 'No time to cook')
    await user.type(screen.getByLabelText('Desire'), 'Feed family well')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))

    await waitFor(() =>
      expect(mockedApi.createAudience).toHaveBeenCalledWith('biz-1', {
        description: 'Busy parents',
        ageMin: 30,
        ageMax: 55,
        location: undefined,
        interests: undefined,
        problem: 'No time to cook',
        desire: 'Feed family well',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid age range')
  })
})
