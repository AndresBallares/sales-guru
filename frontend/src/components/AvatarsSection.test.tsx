import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarsSection } from './AvatarsSection'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    listAvatars: vi.fn<typeof actual.listAvatars>(),
    updateAvatar: vi.fn<typeof actual.updateAvatar>(),
    deleteAvatar: vi.fn<typeof actual.deleteAvatar>(),
    reorderAvatars: vi.fn<typeof actual.reorderAvatars>(),
    importAvatars: vi.fn<typeof actual.importAvatars>(),
    bulkCreateAvatars: vi.fn<typeof actual.bulkCreateAvatars>(),
  }
})
const mockedApi = vi.mocked(api)

function makeAvatar(
  id: string,
  name: string,
  overrides: Partial<api.BuyerAvatar> = {},
): api.BuyerAvatar {
  return {
    id,
    businessId: 'biz-1',
    name,
    who: `${name} is someone who buys.`,
    purchaseFor: 'self',
    primaryProblems: ['Logo tax', 'Plated fades'],
    unknownProblems: ['Coatings chip'],
    mechanisms: ['Ceramic inlay'],
    alternatives: ['Mejuri'],
    objections: ['Never heard of Venzi'],
    hooks: ['Still time.'],
    creativeAngles: ['A day in the life'],
    concepts: [],
    isActive: true,
    sortOrder: 0,
    deletedAt: null,
    ...overrides,
  }
}

const promo = makeAvatar('a1', 'The Promotion Ring Buyer', { sortOrder: 0 })
const gift = makeAvatar('a2', 'The Deadline Gift-Giver', {
  sortOrder: 1,
  purchaseFor: 'gift',
})
const off = makeAvatar('a3', 'The Heirloom Commissioner', {
  sortOrder: 2,
  isActive: false,
})

function names() {
  return within(screen.getByRole('list', { name: 'Buyer avatars' }))
    .getAllByRole('listitem')
    .map((li) => within(li).getByRole('heading').textContent)
}

async function renderLoaded(list: api.BuyerAvatar[] = [promo, gift, off]) {
  mockedApi.listAvatars.mockResolvedValue(list)
  render(<AvatarsSection businessId="biz-1" />)
  await screen.findByRole('list', { name: 'Buyer avatars' })
}

function item(name: string) {
  return within(screen.getByRole('listitem', { name: new RegExp(`^${name}`) }))
}

// Everything an avatar can do now sits in its three-dot menu: open it, pick the action.
async function choose(name: string, action: string) {
  await userEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }))
  await userEvent.click(screen.getByRole('menuitem', { name: action }))
}

describe('AvatarsSection focusing an avatar', () => {
  beforeEach(() => vi.resetAllMocks())

  it('scrolls to and focuses the avatar it is pointed at (a link from a research run)', async () => {
    mockedApi.listAvatars.mockResolvedValue([promo, gift, off])
    const scroll = vi.fn<() => void>()
    Element.prototype.scrollIntoView = scroll
    render(<AvatarsSection businessId="biz-1" focusAvatarId="a2" />)
    const li = await screen.findByRole('listitem', { name: /^The Deadline Gift-Giver/ })
    await waitFor(() => expect(li).toHaveFocus())
    expect(scroll).toHaveBeenCalled()
  })

  it('does nothing special when the avatar is no longer in the library', async () => {
    mockedApi.listAvatars.mockResolvedValue([promo])
    Element.prototype.scrollIntoView = vi.fn<() => void>()
    render(<AvatarsSection businessId="biz-1" focusAvatarId="gone" />)
    await screen.findByRole('list', { name: 'Buyer avatars' })
    expect(screen.getByRole('listitem', { name: /^The Promotion Ring Buyer/ })).not.toHaveFocus()
  })
})

describe('AvatarsSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('lists active and inactive avatars in order, marking the inactive one', async () => {
    await renderLoaded()

    expect(names()).toEqual([
      'The Promotion Ring Buyer',
      'The Deadline Gift-Giver',
      'The Heirloom Commissioner',
    ])
    expect(item('The Heirloom Commissioner').getByText('Inactive')).toBeInTheDocument()
    expect(item('The Deadline Gift-Giver').getByText('Buys for a gift')).toBeInTheDocument()
    expect(item('The Promotion Ring Buyer').getByText('Buys for themselves')).toBeInTheDocument()
    expect(mockedApi.listAvatars).toHaveBeenCalledWith('biz-1')
  })

  it('says so when there are no avatars yet', async () => {
    mockedApi.listAvatars.mockResolvedValue([])
    render(<AvatarsSection businessId="biz-1" />)

    expect(await screen.findByText(/No buyer avatars yet/)).toBeInTheDocument()
  })

  it('reports a load failure and can try again', async () => {
    mockedApi.listAvatars.mockRejectedValueOnce(new api.ApiError(500, 'Server fell over'))
    render(<AvatarsSection businessId="biz-1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server fell over')
    mockedApi.listAvatars.mockResolvedValue([promo])
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByRole('heading', { name: 'The Promotion Ring Buyer' }),
    ).toBeInTheDocument()
  })

  it('opens every field for editing, including who the avatar buys for', async () => {
    await renderLoaded()

    await choose('The Promotion Ring Buyer', 'Edit avatar')

    const form = screen.getByRole('form', {
      name: 'Edit The Promotion Ring Buyer',
    })
    expect(within(form).getByLabelText('Name')).toHaveValue('The Promotion Ring Buyer')
    expect(within(form).getByLabelText('Who they are')).toHaveValue(
      'The Promotion Ring Buyer is someone who buys.',
    )
    expect(within(form).getByLabelText('Buys for')).toHaveValue('self')
    expect(within(form).getByLabelText('Primary problems')).toHaveValue('Logo tax\nPlated fades')
    for (const label of [
      'Unknown problems',
      'Mechanisms',
      'Current alternatives',
      'Objections',
      'Hooks',
      'Creative angles',
    ]) {
      expect(within(form).getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('saves edits as a patch and shows the result', async () => {
    await renderLoaded()
    mockedApi.updateAvatar.mockResolvedValue({
      ...promo,
      name: 'Milestone Buyer',
      purchaseFor: 'gift',
      hooks: ['One', 'Two'],
    })
    await choose('The Promotion Ring Buyer', 'Edit avatar')
    const form = screen.getByRole('form', {
      name: 'Edit The Promotion Ring Buyer',
    })

    await userEvent.clear(within(form).getByLabelText('Name'))
    await userEvent.type(within(form).getByLabelText('Name'), 'Milestone Buyer')
    await userEvent.selectOptions(within(form).getByLabelText('Buys for'), 'gift')
    await userEvent.clear(within(form).getByLabelText('Hooks'))
    await userEvent.type(within(form).getByLabelText('Hooks'), 'One{Enter}Two{Enter}')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mockedApi.updateAvatar).toHaveBeenCalled())
    expect(mockedApi.updateAvatar).toHaveBeenCalledWith(
      'biz-1',
      'a1',
      expect.objectContaining({
        name: 'Milestone Buyer',
        purchaseFor: 'gift',
        hooks: ['One', 'Two'],
        primaryProblems: ['Logo tax', 'Plated fades'],
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Milestone Buyer' })).toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('keeps the form open and shows the reason when saving fails', async () => {
    await renderLoaded()
    mockedApi.updateAvatar.mockRejectedValue(new api.ApiError(422, 'Name is too long'))
    await choose('The Promotion Ring Buyer', 'Edit avatar')

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Name is too long')
    expect(screen.getByRole('form', { name: 'Edit The Promotion Ring Buyer' })).toBeInTheDocument()
  })

  it('cancels an edit without saving', async () => {
    await renderLoaded()
    await choose('The Promotion Ring Buyer', 'Edit avatar')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(mockedApi.updateAvatar).not.toHaveBeenCalled()
  })

  it('deactivates and reactivates an avatar', async () => {
    await renderLoaded()
    mockedApi.updateAvatar.mockResolvedValueOnce({ ...promo, isActive: false })

    await choose('The Promotion Ring Buyer', 'Deactivate avatar')

    expect(mockedApi.updateAvatar).toHaveBeenCalledWith('biz-1', 'a1', {
      isActive: false,
    })
    expect(await item('The Promotion Ring Buyer').findByText('Inactive')).toBeInTheDocument()

    mockedApi.updateAvatar.mockResolvedValueOnce({ ...promo, isActive: true })
    await choose('The Promotion Ring Buyer', 'Activate avatar')

    expect(mockedApi.updateAvatar).toHaveBeenLastCalledWith('biz-1', 'a1', {
      isActive: true,
    })
    await waitFor(() =>
      expect(item('The Promotion Ring Buyer').queryByText('Inactive')).not.toBeInTheDocument(),
    )
  })

  it('moves an avatar down and up, keeping focus on the button used', async () => {
    await renderLoaded()
    mockedApi.reorderAvatars.mockResolvedValueOnce([
      { ...gift, sortOrder: 0 },
      { ...promo, sortOrder: 1 },
      { ...off, sortOrder: 2 },
    ])

    await choose('The Promotion Ring Buyer', 'Move down')

    expect(mockedApi.reorderAvatars).toHaveBeenCalledWith('biz-1', ['a2', 'a1', 'a3'])
    await waitFor(() =>
      expect(names()).toEqual([
        'The Deadline Gift-Giver',
        'The Promotion Ring Buyer',
        'The Heirloom Commissioner',
      ]),
    )
    // Focus follows the avatar: its reorder handle, in its new place.
    expect(screen.getByRole('button', { name: /^Reorder The Promotion Ring Buyer/ })).toHaveFocus()
  })

  it('cannot move the first avatar up or the last one down', async () => {
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'More actions for The Promotion Ring Buyer' }))
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Move to top' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'More actions for The Heirloom Commissioner' }))
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'More actions for The Deadline Gift-Giver' }))
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Move to top' })).toBeEnabled()
  })

  it('keeps focus on the avatar\'s handle when a move leaves it at the end of the list', async () => {
    await renderLoaded([promo, gift])
    mockedApi.reorderAvatars.mockResolvedValueOnce([
      { ...gift, sortOrder: 0 },
      { ...promo, sortOrder: 1 },
    ])

    await choose('The Promotion Ring Buyer', 'Move down')

    await waitFor(() => expect(names()[1]).toBe('The Promotion Ring Buyer'))
    expect(screen.getByRole('button', { name: /^Reorder The Promotion Ring Buyer/ })).toHaveFocus()
  })

  it('shows why a reorder failed and keeps the old order', async () => {
    await renderLoaded()
    mockedApi.reorderAvatars.mockRejectedValue(new api.ApiError(409, 'The avatar list has changed'))

    await choose('The Promotion Ring Buyer', 'Move down')

    expect(await screen.findByRole('alert')).toHaveTextContent('The avatar list has changed')
    expect(names()[0]).toBe('The Promotion Ring Buyer')
  })

  it('asks before deleting, and cancelling deletes nothing', async () => {
    await renderLoaded()

    await choose('The Promotion Ring Buyer', 'Delete avatar')

    const confirm = screen.getByRole('group', {
      name: 'Confirm deleting The Promotion Ring Buyer',
    })
    expect(confirm).toHaveTextContent('Ads and results that used it keep its name, marked archived')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))

    expect(mockedApi.deleteAvatar).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: /Confirm deleting/ })).not.toBeInTheDocument()
    expect(names()).toContain('The Promotion Ring Buyer')
  })

  it('moves focus into the confirmation, onto its safe choice', async () => {
    await renderLoaded()

    await choose('The Promotion Ring Buyer', 'Delete avatar')

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('deletes after confirmation and moves focus to the section heading', async () => {
    await renderLoaded()
    mockedApi.deleteAvatar.mockResolvedValue(undefined)

    await choose('The Promotion Ring Buyer', 'Delete avatar')
    await userEvent.click(screen.getByRole('button', { name: 'Delete avatar' }))

    expect(mockedApi.deleteAvatar).toHaveBeenCalledWith('biz-1', 'a1')
    await waitFor(() =>
      expect(names()).toEqual(['The Deadline Gift-Giver', 'The Heirloom Commissioner']),
    )
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Buyer avatars', level: 2 })).toHaveFocus(),
    )
  })

  it('shows why a delete failed', async () => {
    await renderLoaded()
    mockedApi.deleteAvatar.mockRejectedValue(new api.ApiError(500, 'Could not delete'))

    await choose('The Promotion Ring Buyer', 'Delete avatar')
    await userEvent.click(screen.getByRole('button', { name: 'Delete avatar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete')
    expect(names()).toContain('The Promotion Ring Buyer')
  })

  it('opens the document import from the header, and reloads the list after it saves', async () => {
    await renderLoaded([promo])
    const imported = makeAvatar('a9', 'Last-minute giver', { sortOrder: 1 })
    mockedApi.importAvatars.mockResolvedValue({
      drafts: [{ ...imported, isActive: true, sortOrder: null }],
      warnings: [],
    })
    mockedApi.bulkCreateAvatars.mockResolvedValue([imported])
    mockedApi.listAvatars.mockResolvedValue([promo, imported])

    await userEvent.click(screen.getByRole('button', { name: 'Import from document' }))
    await userEvent.type(screen.getByLabelText('Research document'), 'Gift buyers panic.')
    await userEvent.click(screen.getByRole('button', { name: 'Read document' }))
    await userEvent.click(await screen.findByRole('button', { name: /Save 1 selected/ }))

    await waitFor(() => expect(names()).toEqual(['The Promotion Ring Buyer', 'Last-minute giver']))
    expect(mockedApi.listAvatars).toHaveBeenCalledTimes(2)
  })

  it('does not pull focus back to a move button when the list changes later', async () => {
    await renderLoaded()
    mockedApi.reorderAvatars.mockResolvedValueOnce([
      { ...gift, sortOrder: 0 },
      { ...promo, sortOrder: 1 },
      { ...off, sortOrder: 2 },
    ])
    await choose('The Promotion Ring Buyer', 'Move down')
    await waitFor(() => expect(names()[1]).toBe('The Promotion Ring Buyer'))
    mockedApi.deleteAvatar.mockResolvedValue(undefined)

    await choose('The Heirloom Commissioner', 'Delete avatar')
    await userEvent.click(screen.getByRole('button', { name: 'Delete avatar' }))

    await waitFor(() =>
      expect(names()).toEqual(['The Deadline Gift-Giver', 'The Promotion Ring Buyer']),
    )
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Buyer avatars', level: 2 })).toHaveFocus(),
    )
  })
  describe('concepts', () => {
    const withConcepts = makeAvatar('a1', 'The Promotion Ring Buyer', {
      concepts: [
        { slug: 'last-minute-rescue', pillar: 'offer', description: 'Still time to gift' },
      ],
    })

    async function openEdit(avatar: api.BuyerAvatar) {
      mockedApi.listAvatars.mockResolvedValue([avatar])
      render(<AvatarsSection businessId="biz-1" />)
      await screen.findByRole('list', { name: 'Buyer avatars' })
      await choose(avatar.name, 'Edit avatar')
      return screen.getByRole('form', { name: `Edit ${avatar.name}` })
    }

    it('shows each concept with its name, pillar and description', async () => {
      const form = await openEdit(withConcepts)

      expect(within(form).getByLabelText('Concept 1 name')).toHaveValue('last minute rescue')
      expect(within(form).getByLabelText('Concept 1 pillar')).toHaveValue('offer')
      expect(within(form).getByLabelText('Concept 1 description')).toHaveValue(
        'Still time to gift',
      )
    })

    it('adds, edits and removes concepts and saves them by name', async () => {
      const form = await openEdit(withConcepts)
      mockedApi.updateAvatar.mockResolvedValue({ ...withConcepts })

      await userEvent.click(within(form).getByRole('button', { name: 'Add concept' }))
      await userEvent.type(within(form).getByLabelText('Concept 2 name'), 'Solid gold')
      await userEvent.selectOptions(within(form).getByLabelText('Concept 2 pillar'), 'mechanism')
      await userEvent.type(within(form).getByLabelText('Concept 2 description'), 'Gold all through')
      await userEvent.click(within(form).getByRole('button', { name: 'Remove concept 1' }))
      await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

      await waitFor(() => expect(mockedApi.updateAvatar).toHaveBeenCalled())
      expect(mockedApi.updateAvatar).toHaveBeenCalledWith(
        'biz-1',
        'a1',
        expect.objectContaining({
          concepts: [{ name: 'Solid gold', pillar: 'mechanism', description: 'Gold all through' }],
        }),
      )
    })

    it('stops adding at five concepts', async () => {
      const form = await openEdit(makeAvatar('a1', 'The Promotion Ring Buyer'))

      for (let n = 0; n < 5; n += 1) {
        await userEvent.click(within(form).getByRole('button', { name: 'Add concept' }))
      }

      expect(within(form).getByRole('button', { name: 'Add concept' })).toBeDisabled()
      expect(within(form).getByLabelText('Concept 5 name')).toBeInTheDocument()
    })

    it('leaves out concepts that have no name or description', async () => {
      const form = await openEdit(makeAvatar('a1', 'The Promotion Ring Buyer'))
      mockedApi.updateAvatar.mockResolvedValue(promo)

      await userEvent.click(within(form).getByRole('button', { name: 'Add concept' }))
      await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

      await waitFor(() => expect(mockedApi.updateAvatar).toHaveBeenCalled())
      expect(mockedApi.updateAvatar).toHaveBeenCalledWith(
        'biz-1',
        'a1',
        expect.objectContaining({ concepts: [] }),
      )
    })
  })
})
