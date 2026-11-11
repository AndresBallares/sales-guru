import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BuyerAvatar } from '../lib/api'
import type { ReviewDraft } from '../lib/research'
import { ResearchDashAvatars } from './ResearchDashAvatars'

function makeDraft(name: string, over: Partial<ReviewDraft> = {}, lists: Partial<ReviewDraft['lists']> = {}): ReviewDraft {
  return {
    keep: false,
    name,
    who: `${name} buys fine jewelry for daily wear.`,
    purchaseFor: 'self',
    lists: {
      primaryProblems: 'Colour chips quickly',
      unknownProblems: '',
      mechanisms: 'Scratch-proof ceramic inlay',
      alternatives: '',
      objections: 'Is it really chip proof?',
      hooks: '',
      creativeAngles: '',
      ...lists,
    },
    concepts: [
      { name: 'a', pillar: 'offer', description: 'x' },
      { name: 'b', pillar: 'emotion', description: 'y' },
      { name: 'c', pillar: 'education', description: 'z' },
    ],
    inferred: false,
    ...over,
  }
}

function renderGallery(drafts: ReviewDraft[], extra: { savedBy?: Map<number, string>; library?: BuyerAvatar[] } = {}) {
  const onChange = vi.fn()
  render(
    <ResearchDashAvatars
      drafts={drafts}
      initialDrafts={drafts}
      savedBy={extra.savedBy ?? new Map()}
      library={extra.library ?? []}
      terms={[]}
      savedCount={extra.savedBy?.size ?? 0}
      selectedCount={0}
      slotsLeft={12}
      onChange={onChange}
      onOpenAvatar={vi.fn()}
    />,
  )
  return onChange
}

describe('avatar cards', () => {
  it('say who the customer is, what wins them, their problem and objection, and the concepts', () => {
    renderGallery([makeDraft('The Chipped-Color Veteran')])
    expect(screen.getByText('1 customer avatar')).toBeInTheDocument()
    const card = screen.getByRole('listitem', { name: 'The Chipped-Color Veteran' })
    expect(within(card).getByText('Self-purchaser')).toBeInTheDocument()
    expect(within(card).getAllByText(/buys fine jewelry for daily wear/)[0]).toBeInTheDocument()
    expect(within(card).getAllByText('Scratch-proof ceramic inlay')[0]).toBeInTheDocument()
    expect(within(card).getAllByText('Colour chips quickly')[0]).toBeInTheDocument()
    expect(within(card).getAllByText('Is it really chip proof?')[0]).toBeInTheDocument()
    expect(within(card).getByText('What wins them')).toBeInTheDocument()
    expect(within(card).getByText('Primary problem')).toBeInTheDocument()
    expect(within(card).getByText('Buying objection')).toBeInTheDocument()
    expect(within(card).getByText('3 Creative Concepts')).toBeInTheDocument()
  })

  it('names a gift buyer and a single concept in the singular', () => {
    renderGallery([makeDraft('The Gifter', { purchaseFor: 'gift', concepts: [{ name: 'a', pillar: 'offer', description: 'x' }] })])
    const card = screen.getByRole('listitem', { name: 'The Gifter' })
    expect(within(card).getByText('Gift-buyer')).toBeInTheDocument()
    expect(within(card).getByText('1 Creative Concept')).toBeInTheDocument()
  })

  it('leaves out what is missing, and never shows an age range or an empty label', () => {
    renderGallery([makeDraft('Sparse', { concepts: [] }, { primaryProblems: '', objections: '', mechanisms: '' })])
    const card = screen.getByRole('listitem', { name: 'Sparse' })
    expect(within(card).queryByText('Primary problem')).not.toBeInTheDocument()
    expect(within(card).queryByText('Buying objection')).not.toBeInTheDocument()
    expect(within(card).queryByText('What wins them')).not.toBeInTheDocument()
    expect(within(card).queryByText(/Creative Concept/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/\bage\b/i)).not.toBeInTheDocument()
  })

  it('keeps selecting, editing and the saved link working', async () => {
    const user = userEvent.setup()
    const onChange = renderGallery([makeDraft('One'), makeDraft('Two')], {
      savedBy: new Map([[1, 'avatar-2']]),
      library: [],
    })
    const one = screen.getByRole('listitem', { name: 'One' })
    await user.click(within(one).getByRole('checkbox', { name: /Save One/ }))
    expect(onChange).toHaveBeenCalledWith(0, { keep: true })
    expect(within(one).getByLabelText('Name')).toHaveValue('One')
    const two = screen.getByRole('listitem', { name: 'Two' })
    expect(within(two).getByText('Saved')).toBeInTheDocument()
    expect(within(two).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(two).getByRole('link', { name: /View Two in your library/ })).toBeInTheDocument()
  })
})

describe('view all avatars', () => {
  const many = Array.from({ length: 8 }, (_, i) => makeDraft(`Avatar ${i + 1}`))

  it('shows six, then all of them on request', async () => {
    const user = userEvent.setup()
    renderGallery(many)
    expect(within(screen.getByRole('list', { name: 'Avatar drafts' })).getAllByRole('listitem')).toHaveLength(6)
    await user.click(screen.getByRole('button', { name: 'View all 8 avatars' }))
    expect(within(screen.getByRole('list', { name: 'Avatar drafts' })).getAllByRole('listitem')).toHaveLength(8)
    await user.click(screen.getByRole('button', { name: 'Show fewer avatars' }))
    expect(within(screen.getByRole('list', { name: 'Avatar drafts' })).getAllByRole('listitem')).toHaveLength(6)
  })

  it('offers nothing to expand when six or fewer', () => {
    renderGallery(many.slice(0, 6))
    expect(screen.queryByRole('button', { name: /View all/ })).not.toBeInTheDocument()
  })
})
