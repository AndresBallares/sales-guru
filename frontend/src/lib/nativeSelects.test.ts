import { describe, expect, it } from 'vitest'

// Every dropdown in the app is a native <select>, which is what iOS Safari opens with its own
// picker. A hand-built dropdown (a listbox or combobox of divs and buttons) is what breaks on
// phones, so this fails if one is introduced.
const sources = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const appFiles = Object.entries(sources).filter(([path]) => !path.endsWith('.test.tsx'))

describe('dropdowns', () => {
  it('are native selects: no custom listbox, combobox or datalist anywhere', () => {
    const custom = appFiles
      .filter(([, text]) =>
        /role=["'](listbox|combobox)["']|<datalist\b|aria-haspopup=["']listbox["']/.test(text),
      )
      .map(([path]) => path)

    expect(custom).toEqual([])
  })

  it('still has the app’s native selects', () => {
    const withSelect = appFiles.filter(([, text]) => /<select\b/.test(text))

    expect(withSelect.length).toBeGreaterThan(10)
  })
})
