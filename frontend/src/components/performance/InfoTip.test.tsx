import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InfoTip } from './InfoTip'

describe('InfoTip', () => {
  it('opens a tooltip with what, why and how when the icon is clicked', async () => {
    render(<InfoTip metric="roas" />)

    const button = screen.getByRole('button', { name: /About Return on Ad Spend/ })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Return on Ad Spend.')
    expect(tip).toHaveTextContent('In plain English')
    expect(tip).toHaveTextContent('Why it matters')
    expect(tip).toHaveTextContent('How to read it')
  })

  it('closes on a second click and on Escape', async () => {
    render(<InfoTip metric="cac" />)
    const button = screen.getByRole('button', { name: /About Cost Per Sale/ })

    await userEvent.click(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await userEvent.click(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('opens when the icon is hovered or focused', async () => {
    render(<InfoTip metric="cpm" />)
    const button = screen.getByRole('button', { name: /About CPM/ })

    await userEvent.hover(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await userEvent.unhover(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await userEvent.tab()
    expect(button).toHaveFocus()
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('points the button at the tooltip it opens', async () => {
    render(<InfoTip metric="reach" />)
    const button = screen.getByRole('button')
    await userEvent.click(button)

    expect(button.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
  })
})
