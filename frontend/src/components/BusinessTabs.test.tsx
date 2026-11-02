import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BusinessTabs } from './BusinessTabs'

const tabs = [
  {
    id: 'results',
    label: 'Results and campaigns',
    content: <p>Results content</p>,
    keepMounted: true,
  },
  { id: 'avatars', label: 'Avatars', content: <p>Avatars content</p> },
  { id: 'extra', label: 'Extra', content: <p>Extra content</p> },
]

function Harness({
  initial = 'results',
  onSelect = () => {},
}: {
  initial?: string
  onSelect?: (id: string) => void
}) {
  const [selected, setSelected] = useState(initial)
  return (
    <BusinessTabs
      tabs={tabs}
      selected={selected}
      onSelect={(id) => {
        setSelected(id)
        onSelect(id)
      }}
    />
  )
}

describe('BusinessTabs', () => {
  it('is a labelled tablist with one tab selected and only its panel shown', () => {
    render(<Harness />)

    expect(screen.getByRole('tablist', { name: 'Sections of this business' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Results and campaigns' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Avatars' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: 'Results and campaigns' })).toHaveTextContent(
      'Results content',
    )
    expect(screen.queryByText('Avatars content')).not.toBeInTheDocument()
  })

  it('links each tab to its panel', () => {
    render(<Harness initial="avatars" />)

    const tab = screen.getByRole('tab', { name: 'Avatars' })
    const panel = screen.getByRole('tabpanel', { name: 'Avatars' })
    expect(tab).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', tab.id)
  })

  it('keeps only the selected tab in the tab order', () => {
    render(<Harness />)

    expect(screen.getByRole('tab', { name: 'Results and campaigns' })).toHaveAttribute(
      'tabindex',
      '0',
    )
    expect(screen.getByRole('tab', { name: 'Avatars' })).toHaveAttribute('tabindex', '-1')
  })

  it('selects a tab on click', async () => {
    const onSelect = vi.fn<(id: string) => void>()
    render(<Harness onSelect={onSelect} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Avatars' }))

    expect(onSelect).toHaveBeenCalledWith('avatars')
    expect(screen.getByText('Avatars content')).toBeVisible()
    expect(screen.getByText('Results content')).not.toBeVisible()
  })

  it('moves with the arrow keys, wrapping at both ends, and moves focus with it', async () => {
    render(<Harness />)
    screen.getByRole('tab', { name: 'Results and campaigns' }).focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Avatars' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Avatars' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Results and campaigns' })).toHaveFocus()

    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Extra' })).toHaveFocus()
  })

  it('jumps to the first and last tab with Home and End', async () => {
    render(<Harness initial="avatars" />)
    screen.getByRole('tab', { name: 'Avatars' }).focus()

    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Extra' })).toHaveFocus()

    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Results and campaigns' })).toHaveFocus()
  })

  it('opens on whichever tab it is told is selected', () => {
    render(<Harness initial="avatars" />)

    expect(screen.getByRole('tab', { name: 'Avatars' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Avatars content')).toBeInTheDocument()
  })

  it('falls back to the first tab for an id it does not know', () => {
    render(<Harness initial="nope" />)

    expect(screen.getByRole('tab', { name: 'Results and campaigns' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('Results content')).toBeInTheDocument()
  })

  it('keeps a keepMounted tab’s content mounted but hidden once it has been shown', async () => {
    render(<Harness />)

    await userEvent.click(screen.getByRole('tab', { name: 'Avatars' }))

    expect(screen.getByText('Results content')).not.toBeVisible()
    expect(screen.getByText('Avatars content')).toBeVisible()
    expect(
      screen.queryByRole('tabpanel', { name: 'Results and campaigns' }),
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Results and campaigns' }))

    expect(screen.getByText('Results content')).toBeVisible()
    expect(screen.queryByText('Avatars content')).not.toBeInTheDocument()
  })

  it('does not mount a keepMounted tab before it is first shown', () => {
    render(<Harness initial="avatars" />)

    expect(screen.queryByText('Results content')).not.toBeInTheDocument()
  })
})
