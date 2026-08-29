import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeContext'

function mockSystemPreference(prefersDark: boolean) {
  window.matchMedia = vi.fn<typeof window.matchMedia>().mockImplementation(
    (query: string): MediaQueryList => ({
      matches: query === '(prefers-color-scheme: dark)' && prefersDark,
      media: query,
      onchange: null,
      addListener: vi.fn<() => void>(),
      removeListener: vi.fn<() => void>(),
      addEventListener: vi.fn<() => void>(),
      removeEventListener: vi.fn<() => void>(),
      dispatchEvent: vi.fn<() => boolean>(),
    }),
  )
}

function TestConsumer() {
  const { theme, toggleTheme } = useTheme()
  return (
    <div>
      <p>theme: {theme}</p>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ThemeProvider', () => {
  it('falls back to the system preference (dark) when nothing is stored', () => {
    mockSystemPreference(true)

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    )

    expect(screen.getByText('theme: dark')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('falls back to the system preference (light) when nothing is stored', () => {
    mockSystemPreference(false)

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    )

    expect(screen.getByText('theme: light')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('prefers a stored choice over the system preference', () => {
    mockSystemPreference(true)
    window.localStorage.setItem('sales-guru-theme', 'light')

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    )

    expect(screen.getByText('theme: light')).toBeInTheDocument()
  })

  it('toggleTheme flips the theme and persists the choice', async () => {
    mockSystemPreference(false)
    const user = userEvent.setup()

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    )
    expect(screen.getByText('theme: light')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'toggle' }))

    expect(screen.getByText('theme: dark')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('sales-guru-theme')).toBe('dark')

    await user.click(screen.getByRole('button', { name: 'toggle' }))

    expect(screen.getByText('theme: light')).toBeInTheDocument()
    expect(window.localStorage.getItem('sales-guru-theme')).toBe('light')
  })
})

describe('useTheme', () => {
  it('throws when used outside a ThemeProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<TestConsumer />)).toThrow(
      'useTheme must be used within a ThemeProvider',
    )

    consoleError.mockRestore()
  })
})
