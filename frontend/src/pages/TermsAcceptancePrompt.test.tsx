import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TermsAcceptancePrompt } from './TermsAcceptancePrompt'
import { AuthProvider } from '../context/AuthContext'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getMe: vi.fn<typeof actual.getMe>(),
    acceptTerms: vi.fn<typeof actual.acceptTerms>(),
  }
})
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.getMe.mockRejectedValue(new api.ApiError(401, 'Not authenticated'))
})

function renderPrompt() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <TermsAcceptancePrompt />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('TermsAcceptancePrompt', () => {
  it('keeps Continue disabled until the checkbox is checked', async () => {
    const user = userEvent.setup()
    renderPrompt()

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('calls acceptTerms when Continue is clicked', async () => {
    mockedApi.acceptTerms.mockResolvedValue({
      id: '1',
      email: 'existing@example.com',
      needsTermsAcceptance: false,
    })
    const user = userEvent.setup()
    renderPrompt()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockedApi.acceptTerms).toHaveBeenCalled()
  })

  it('shows an error message if accepting fails', async () => {
    mockedApi.acceptTerms.mockRejectedValue(new api.ApiError(500, 'Something broke'))
    const user = userEvent.setup()
    renderPrompt()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something broke')
  })
})
