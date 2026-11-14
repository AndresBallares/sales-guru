import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BuyerAvatarCard } from './BuyerAvatarCard'
import type { BuyerAvatar } from '../lib/api'

const avatar: BuyerAvatar = {
  id: 'a1',
  businessId: 'biz-1',
  name: 'The Promotion Ring Buyer',
  who: 'Marks a milestone.',
  purchaseFor: 'self',
  primaryProblems: ['Logo tax'],
  unknownProblems: [],
  mechanisms: [],
  alternatives: [],
  objections: [],
  hooks: [],
  creativeAngles: [],
  concepts: [],
  isActive: true,
  sortOrder: 0,
  deletedAt: null,
}

function renderCard(onOpen?: (avatar: BuyerAvatar) => void) {
  const noop = () => undefined
  render(
    <ul>
      <BuyerAvatarCard
        avatar={avatar}
        index={0}
        total={1}
        busy={false}
        editing={false}
        dragging={false}
        over={false}
        armed={false}
        hintId="hint"
        actions={{
          onEdit: noop,
          onToggleActive: noop,
          onMoveToTop: noop,
          onMoveUp: noop,
          onMoveDown: noop,
          onAskDelete: noop,
        }}
        onArm={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
        onDragEnd={noop}
        onHandleKey={noop}
        onOpen={onOpen}
      />
    </ul>,
  )
}

describe('BuyerAvatarCard View details', () => {
  it('hands the avatar to onOpen when it opens the card, and not when it closes it', async () => {
    const onOpen = vi.fn<(avatar: BuyerAvatar) => void>()
    renderCard(onOpen)

    await userEvent.click(screen.getByRole('button', { name: /View details/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(avatar)

    await userEvent.click(screen.getByRole('button', { name: /Hide details/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('still expands when nothing is listening', async () => {
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: /View details/ }))

    expect(screen.getByRole('button', { name: /Hide details/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })
})
