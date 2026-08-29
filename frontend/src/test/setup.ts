import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement matchMedia. Default to "no preference" so any
// component using ThemeContext works out of the box in tests that don't
// care about theming; tests that do (ThemeContext/ThemeToggle) override
// this per-test.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })
}
