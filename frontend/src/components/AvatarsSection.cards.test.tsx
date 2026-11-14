import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    ...overrides,
  }
}

const promo = makeAvatar('a1', 'The Promotion Ring Buyer', { sortOrder: 0 })
const gift = makeAvatar('a2', 'The Deadline Gift-Giver', { sortOrder: 1, purchaseFor: 'gift' })
const off = makeAvatar('a3', 'The Heirloom Commissioner', { sortOrder: 2, isActive: false })

async function renderLoaded(list: api.BuyerAvatar[] = [promo, gift, off]) {
  mockedApi.listAvatars.mockResolvedValue(list)
  render(<AvatarsSection businessId="biz-1" />)
  await screen.findByRole('list', { name: 'Buyer avatars' })
}

function names() {
  return within(screen.getByRole('list', { name: 'Buyer avatars' }))
    .getAllByRole('listitem')
    .map((li) => within(li).getByRole('heading').textContent)
}

function card(name: string) {
  return screen.getByRole('listitem', { name: new RegExp(`^${name}`) })
}

function handle(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^Reorder ${name}`) })
}

// A real drag: press the handle (which arms the card), then drag one card onto another.
function drag(from: string, onto: string) {
  fireEvent.pointerDown(handle(from))
  const source = card(from)
  const target = card(onto)
  const dataTransfer = { setData: vi.fn<() => void>(), effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  fireEvent.dragEnd(source, { dataTransfer })
}

function manyAvatars(count: number): api.BuyerAvatar[] {
  return Array.from({ length: count }, (_, n) => makeAvatar(`m${n}`, `Avatar ${n}`, { sortOrder: n }))
}

describe('the header', () => {
  beforeEach(() => vi.resetAllMocks())

  it('names the section, explains it, and shows the real usage count', async () => {
    await renderLoaded()

    expect(screen.getByRole('heading', { name: 'AI Customer Avatars', level: 2 })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Discover the customer profiles identified through AI-powered market research. Explore their motivations, challenges, and purchasing behaviors.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('3 of 12 avatars')).toBeInTheDocument()
  })

  it('takes the count from the avatars it loaded, not a fixed number', async () => {
    await renderLoaded([promo])

    expect(screen.getByText('1 of 12 avatars')).toBeInTheDocument()
  })

  it('has Create avatar and Import from document next to the heading', async () => {
    await renderLoaded()

    expect(screen.getByRole('button', { name: 'Create avatar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Import from document' })).toBeEnabled()
  })

  it('explains that the order matters, and that inactive avatars are skipped', async () => {
    await renderLoaded()

    const panel = screen.getByRole('region', { name: 'Prioritize your audiences' })
    expect(panel).toHaveTextContent('Drag and drop your buyer avatars')
    expect(panel).toHaveTextContent('Inactive avatars are skipped')
    expect(panel).toHaveTextContent('prefers the ones higher up')
  })

  it('opens the document import from the header button', async () => {
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'Import from document' }))

    expect(screen.getByLabelText('Research document')).toBeVisible()
  })
})

describe('an avatar card', () => {
  beforeEach(() => vi.resetAllMocks())

  it('numbers the cards from the persisted order, inactive ones too', async () => {
    await renderLoaded()

    expect(within(card('The Promotion Ring Buyer')).getByText('01')).toBeInTheDocument()
    expect(within(card('The Deadline Gift-Giver')).getByText('02')).toBeInTheDocument()
    expect(within(card('The Heirloom Commissioner')).getByText('03')).toBeInTheDocument()
  })

  it('shows the name, the buyer type, the status and the who text', async () => {
    await renderLoaded()

    const first = within(card('The Promotion Ring Buyer'))
    expect(first.getByRole('heading', { name: 'The Promotion Ring Buyer', level: 3 })).toBeInTheDocument()
    expect(first.getByText('Buys for themselves')).toBeInTheDocument()
    expect(first.getByText('Active')).toBeInTheDocument()
    expect(first.getByText('The Promotion Ring Buyer is someone who buys.')).toBeInTheDocument()
    expect(within(card('The Deadline Gift-Giver')).getByText('Buys for a gift')).toBeInTheDocument()
  })

  it('marks an inactive avatar and mutes its card', async () => {
    await renderLoaded()

    const inactive = card('The Heirloom Commissioner')
    expect(within(inactive).getByText('Inactive')).toBeInTheDocument()
    expect(within(inactive).queryByText('Active')).not.toBeInTheDocument()
    expect(inactive).toHaveClass('is-inactive')
    expect(card('The Promotion Ring Buyer')).not.toHaveClass('is-inactive')
  })

  it('invents no age range', async () => {
    await renderLoaded()

    expect(screen.queryByText(/years old/)).not.toBeInTheDocument()
  })

  it('has no permanently visible Edit, Deactivate, Move or Delete buttons', async () => {
    await renderLoaded()

    for (const name of [/^Edit/, /^Deactivate/, /^Activate/, /^Move/, /^Delete/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: /^More actions for / })).toHaveLength(3)
  })

  it('keeps the whole description in the page, clamped until View details opens the card', async () => {
    const long = 'Someone who shops carefully and compares everything. '.repeat(8).trim()
    await renderLoaded([makeAvatar('a1', 'Long One', { who: long }), gift])

    const who = within(card('Long One')).getByText(long)
    expect(who).not.toHaveClass('is-expanded')
    await userEvent.click(within(card('Long One')).getByRole('button', { name: /View details/ }))
    expect(who).toHaveClass('is-expanded')
    expect(within(card('Long One')).getByRole('button', { name: /Hide details/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(card('Long One')).queryByRole('button', { name: /Show more/ })).toBeNull()
  })

  it('lists every action in the menu, with Move to top', async () => {
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'More actions for The Deadline Gift-Giver' }))

    const menu = screen.getByRole('menu', { name: 'Actions for The Deadline Gift-Giver' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Edit avatar',
      'Deactivate avatar',
      'Move to top',
      'Move up',
      'Move down',
      'Delete avatar',
    ])
  })

  it('offers Activate for an inactive avatar', async () => {
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'More actions for The Heirloom Commissioner' }))

    expect(screen.getByRole('menuitem', { name: 'Activate avatar' })).toBeInTheDocument()
  })

  it('moves an avatar to the top with the existing reorder call', async () => {
    await renderLoaded()
    mockedApi.reorderAvatars.mockResolvedValueOnce([
      { ...off, sortOrder: 0 },
      { ...promo, sortOrder: 1 },
      { ...gift, sortOrder: 2 },
    ])

    await userEvent.click(screen.getByRole('button', { name: 'More actions for The Heirloom Commissioner' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to top' }))

    expect(mockedApi.reorderAvatars).toHaveBeenCalledWith('biz-1', ['a3', 'a1', 'a2'])
    await waitFor(() =>
      expect(names()).toEqual([
        'The Heirloom Commissioner',
        'The Promotion Ring Buyer',
        'The Deadline Gift-Giver',
      ]),
    )
  })

  it('names the avatar in the delete question', async () => {
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'More actions for The Promotion Ring Buyer' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete avatar' }))

    expect(screen.getByRole('group', { name: 'Confirm deleting The Promotion Ring Buyer' })).toHaveTextContent(
      'Delete The Promotion Ring Buyer?',
    )
    expect(mockedApi.deleteAvatar).not.toHaveBeenCalled()
  })
})

describe('drag and drop', () => {
  beforeEach(() => vi.resetAllMocks())

  it('labels the handle with the avatar and its place', async () => {
    await renderLoaded()

    expect(handle('The Deadline Gift-Giver')).toHaveAccessibleName(
      'Reorder The Deadline Gift-Giver, position 2 of 3',
    )
  })

  it('does not make a card draggable until its handle is pressed', async () => {
    await renderLoaded()

    expect(card('The Promotion Ring Buyer')).toHaveAttribute('draggable', 'false')
    fireEvent.pointerDown(handle('The Promotion Ring Buyer'))
    expect(card('The Promotion Ring Buyer')).toHaveAttribute('draggable', 'true')
  })

  it('moves the card at once, renumbers, and saves with the existing reorder call', async () => {
    await renderLoaded()
    let resolve: (value: api.BuyerAvatar[]) => void = () => {}
    mockedApi.reorderAvatars.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      }),
    )

    drag('The Promotion Ring Buyer', 'The Heirloom Commissioner')

    // Before the server answers the cards are already in their new places, renumbered.
    expect(names()).toEqual([
      'The Deadline Gift-Giver',
      'The Heirloom Commissioner',
      'The Promotion Ring Buyer',
    ])
    expect(within(card('The Promotion Ring Buyer')).getByText('03')).toBeInTheDocument()
    expect(mockedApi.reorderAvatars).toHaveBeenCalledTimes(1)
    expect(mockedApi.reorderAvatars).toHaveBeenCalledWith('biz-1', ['a2', 'a3', 'a1'])
    await act(async () => {
      resolve([
        { ...gift, sortOrder: 0 },
        { ...off, sortOrder: 1 },
        { ...promo, sortOrder: 2 },
      ])
    })
    expect(names()[2]).toBe('The Promotion Ring Buyer')
  })

  it('shows the drop place while dragging and clears it afterwards', async () => {
    await renderLoaded()
    fireEvent.pointerDown(handle('The Promotion Ring Buyer'))
    const dataTransfer = { setData: vi.fn<() => void>(), effectAllowed: '' }

    fireEvent.dragStart(card('The Promotion Ring Buyer'), { dataTransfer })
    fireEvent.dragOver(card('The Deadline Gift-Giver'), { dataTransfer })

    expect(card('The Promotion Ring Buyer')).toHaveClass('is-dragging')
    expect(card('The Deadline Gift-Giver')).toHaveClass('is-over')
    fireEvent.dragEnd(card('The Promotion Ring Buyer'), { dataTransfer })
    expect(card('The Promotion Ring Buyer')).not.toHaveClass('is-dragging')
    expect(card('The Deadline Gift-Giver')).not.toHaveClass('is-over')
  })

  it('puts the old order back and says why when saving fails', async () => {
    await renderLoaded()
    mockedApi.reorderAvatars.mockRejectedValue(new api.ApiError(409, 'The avatar list has changed'))

    drag('The Promotion Ring Buyer', 'The Heirloom Commissioner')

    expect(await screen.findByRole('alert')).toHaveTextContent('The avatar list has changed')
    expect(names()).toEqual([
      'The Promotion Ring Buyer',
      'The Deadline Gift-Giver',
      'The Heirloom Commissioner',
    ])
    expect(within(card('The Promotion Ring Buyer')).getByText('01')).toBeInTheDocument()
  })

  it('sends one request while another is still saving', async () => {
    await renderLoaded()
    mockedApi.reorderAvatars.mockReturnValue(new Promise(() => {}))

    drag('The Promotion Ring Buyer', 'The Heirloom Commissioner')
    drag('The Deadline Gift-Giver', 'The Promotion Ring Buyer')

    expect(mockedApi.reorderAvatars).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when a card is dropped on itself', async () => {
    await renderLoaded()

    drag('The Promotion Ring Buyer', 'The Promotion Ring Buyer')

    expect(mockedApi.reorderAvatars).not.toHaveBeenCalled()
  })

  it('moves a card with the arrow keys on its handle, and keeps focus there', async () => {
    await renderLoaded()
    mockedApi.reorderAvatars.mockResolvedValueOnce([
      { ...gift, sortOrder: 0 },
      { ...promo, sortOrder: 1 },
      { ...off, sortOrder: 2 },
    ])
    handle('The Promotion Ring Buyer').focus()

    await userEvent.keyboard('{ArrowDown}')

    expect(mockedApi.reorderAvatars).toHaveBeenCalledWith('biz-1', ['a2', 'a1', 'a3'])
    await waitFor(() => expect(names()[1]).toBe('The Promotion Ring Buyer'))
    expect(handle('The Promotion Ring Buyer')).toHaveFocus()
  })

  it('does not move the first card up with the keyboard', async () => {
    await renderLoaded()
    handle('The Promotion Ring Buyer').focus()

    await userEvent.keyboard('{ArrowUp}')

    expect(mockedApi.reorderAvatars).not.toHaveBeenCalled()
  })

  it('announces the new place to screen readers', async () => {
    await renderLoaded()
    mockedApi.reorderAvatars.mockResolvedValueOnce([
      { ...gift, sortOrder: 0 },
      { ...promo, sortOrder: 1 },
      { ...off, sortOrder: 2 },
    ])
    handle('The Promotion Ring Buyer').focus()

    await userEvent.keyboard('{ArrowDown}')

    await waitFor(() =>
      expect(screen.getByText('The Promotion Ring Buyer moved to position 2 of 3.')).toBeInTheDocument(),
    )
  })

  it('does not start a drag from the menu or the description toggle', async () => {
    await renderLoaded()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions for The Promotion Ring Buyer' }))

    expect(card('The Promotion Ring Buyer')).toHaveAttribute('draggable', 'false')
  })
})

describe('creating an avatar', () => {
  beforeEach(() => vi.resetAllMocks())

  async function openCreate() {
    await userEvent.click(screen.getByRole('button', { name: 'Create avatar' }))
    return screen.getByRole('form', { name: 'New buyer avatar' })
  }

  it('opens an empty form with the same fields as the editor', async () => {
    await renderLoaded()

    const form = await openCreate()

    expect(within(form).getByLabelText('Name')).toHaveValue('')
    expect(within(form).getByLabelText('Who they are')).toHaveValue('')
    expect(within(form).getByLabelText('Buys for')).toHaveValue('self')
    for (const label of ['Primary problems', 'Unknown problems', 'Mechanisms', 'Current alternatives', 'Objections', 'Hooks', 'Creative angles']) {
      expect(within(form).getByLabelText(label)).toBeInTheDocument()
    }
    expect(within(form).getByRole('button', { name: 'Add concept' })).toBeInTheDocument()
  })

  it('saves one draft through the existing bulk call and adds the card at the end', async () => {
    await renderLoaded()
    const created = makeAvatar('n1', 'Anniversary Buyer', { sortOrder: 3, purchaseFor: 'gift', hooks: ['One'] })
    mockedApi.bulkCreateAvatars.mockResolvedValue([created])
    const form = await openCreate()

    await userEvent.type(within(form).getByLabelText('Name'), 'Anniversary Buyer')
    await userEvent.type(within(form).getByLabelText('Who they are'), 'Marks every year.')
    await userEvent.selectOptions(within(form).getByLabelText('Buys for'), 'gift')
    await userEvent.type(within(form).getByLabelText('Hooks'), 'One')
    await userEvent.click(within(form).getByRole('button', { name: 'Save avatar' }))

    await waitFor(() => expect(mockedApi.bulkCreateAvatars).toHaveBeenCalledTimes(1))
    expect(mockedApi.bulkCreateAvatars).toHaveBeenCalledWith('biz-1', [
      expect.objectContaining({
        name: 'Anniversary Buyer',
        who: 'Marks every year.',
        purchaseFor: 'gift',
        hooks: ['One'],
        primaryProblems: [],
        concepts: [],
      }),
    ])
    await waitFor(() => expect(names()[3]).toBe('Anniversary Buyer'))
    expect(within(card('Anniversary Buyer')).getByText('04')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'New buyer avatar' })).not.toBeInTheDocument()
    expect(screen.getByText('4 of 12 avatars')).toBeInTheDocument()
  })

  it('keeps the form open and shows the reason when saving fails', async () => {
    await renderLoaded()
    mockedApi.bulkCreateAvatars.mockRejectedValue(new api.ApiError(422, 'Name is too long'))
    const form = await openCreate()
    await userEvent.type(within(form).getByLabelText('Name'), 'X')
    await userEvent.type(within(form).getByLabelText('Who they are'), 'Y')

    await userEvent.click(within(form).getByRole('button', { name: 'Save avatar' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent('Name is too long')
    expect(screen.getByRole('form', { name: 'New buyer avatar' })).toBeInTheDocument()
  })

  it('cancels without saving', async () => {
    await renderLoaded()
    await openCreate()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('form', { name: 'New buyer avatar' })).not.toBeInTheDocument()
    expect(mockedApi.bulkCreateAvatars).not.toHaveBeenCalled()
  })

  it('is switched off at the limit, says why, and leaves the cards manageable', async () => {
    await renderLoaded(manyAvatars(12))

    expect(screen.getByRole('button', { name: 'Create avatar' })).toBeDisabled()
    expect(screen.getByText('12 of 12 avatars')).toBeInTheDocument()
    expect(screen.getByText(/limit of 12 buyer avatars/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions for Avatar 0' })).toBeEnabled()
  })

  it('stays on below the limit', async () => {
    await renderLoaded(manyAvatars(11))

    expect(screen.getByRole('button', { name: 'Create avatar' })).toBeEnabled()
    expect(screen.queryByText(/limit of 12 buyer avatars/)).not.toBeInTheDocument()
  })
})

describe('the empty state', () => {
  beforeEach(() => vi.resetAllMocks())

  it('invites the owner to create or import their first avatar', async () => {
    mockedApi.listAvatars.mockResolvedValue([])
    render(<AvatarsSection businessId="biz-1" />)

    expect(await screen.findByRole('heading', { name: 'No buyer avatars yet' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Create your first buyer avatar or import audiences from your existing research to get started.',
      ),
    ).toBeInTheDocument()
    const empty = screen.getByRole('region', { name: 'No buyer avatars yet' })
    expect(within(empty).getByRole('button', { name: 'Create avatar' })).toBeEnabled()
    expect(within(empty).getByRole('button', { name: 'Import from document' })).toBeEnabled()
  })

  it('opens the create form from the empty state', async () => {
    mockedApi.listAvatars.mockResolvedValue([])
    render(<AvatarsSection businessId="biz-1" />)
    const empty = await screen.findByRole('region', { name: 'No buyer avatars yet' })

    await userEvent.click(within(empty).getByRole('button', { name: 'Create avatar' }))

    expect(screen.getByRole('form', { name: 'New buyer avatar' })).toBeInTheDocument()
  })
})

describe('the card design', () => {
  beforeEach(() => vi.resetAllMocks())

  const rich = makeAvatar('r1', 'The Chipped-Color Veteran', {
    sortOrder: 0,
    primaryProblems: ['Painted color wears off', 'Cannot tell inlay from coating'],
    unknownProblems: ['Does not know about fired ceramic'],
    mechanisms: ['Ceramic inlay is fired into the gold'],
    alternatives: ['Enamel jewelry'],
    objections: ['Is ceramic really more durable?'],
    hooks: ['Not painted. Fired.'],
    creativeAngles: ['Care card test'],
    concepts: [{ slug: 'care-card-test', pillar: 'mechanism', description: 'Show the care card.' }],
  })

  it('shows the first mechanism as why it works, and the first problem as the pain point', async () => {
    await renderLoaded([rich])

    const c = within(card('The Chipped-Color Veteran'))
    expect(c.getByText('Why it works for them')).toBeInTheDocument()
    expect(c.getByText('Ceramic inlay is fired into the gold', { selector: 'p' })).toBeInTheDocument()
    expect(c.getByText('Primary pain point')).toBeInTheDocument()
    expect(c.getByText('Painted color wears off', { selector: 'p' })).toBeInTheDocument()
  })

  it('leaves out a section the research did not fill in, and invents nothing', async () => {
    await renderLoaded([
      makeAvatar('b1', 'Bare One', { mechanisms: [], primaryProblems: [] }),
      makeAvatar('b2', 'No Mechanism', { mechanisms: [], primaryProblems: ['Logo tax'] }),
    ])

    expect(within(card('Bare One')).queryByText('Why it works for them')).toBeNull()
    expect(within(card('Bare One')).queryByText('Primary pain point')).toBeNull()
    expect(within(card('No Mechanism')).queryByText('Why it works for them')).toBeNull()
    expect(within(card('No Mechanism')).getByText('Primary pain point')).toBeInTheDocument()
  })

  it('highlights the top four priorities and leaves the rest neutral', async () => {
    await renderLoaded(manyAvatars(5))

    const badge = (name: string) => within(card(name)).getByText('Priority', { exact: false })
    for (const n of [0, 1, 2, 3]) {
      expect(badge(`Avatar ${n}`)).toHaveClass('is-top')
    }
    expect(badge('Avatar 4')).not.toHaveClass('is-top')
    expect(within(card('Avatar 0')).getByText('(top audience)')).toBeInTheDocument()
    expect(within(card('Avatar 4')).queryByText('(top audience)')).toBeNull()
  })

  it('draws a portrait with the initials when there is no image', async () => {
    await renderLoaded([rich, gift])

    expect(within(card('The Chipped-Color Veteran')).getByText('CC')).toBeInTheDocument()
    expect(within(card('The Deadline Gift-Giver')).getByText('DG')).toBeInTheDocument()
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('shows a portrait when the avatar has an image URL', async () => {
    await renderLoaded([makeAvatar('i1', 'Pictured One', { imageUrl: '/portraits/one.jpg' })])

    const image = within(card('Pictured One')).getByRole('presentation', { hidden: true })
    expect(image).toHaveAttribute('src', '/portraits/one.jpg')
    expect(image).toHaveAttribute('loading', 'lazy')
  })

  it('keeps every saved field out of view until View details, then shows all of them', async () => {
    await renderLoaded([rich])
    const c = within(card('The Chipped-Color Veteran'))

    const toggle = c.getByRole('button', { name: /View details/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(c.queryByText('Is ceramic really more durable?')).not.toBeVisible()

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(c.getByText('Primary problems')).toBeVisible()
    expect(c.getByText('Cannot tell inlay from coating')).toBeVisible()
    expect(c.getByText('Unknown problems')).toBeVisible()
    expect(c.getByText('Mechanisms')).toBeVisible()
    expect(c.getByText('Current alternatives')).toBeVisible()
    expect(c.getByText('Is ceramic really more durable?')).toBeVisible()
    expect(c.getByText('Not painted. Fired.')).toBeVisible()
    expect(c.getByText('Care card test')).toBeVisible()
    expect(c.getByText('Ad concepts')).toBeVisible()
    expect(c.getByText('care-card-test: Show the care card.')).toBeVisible()

    await userEvent.click(toggle)
    expect(c.getByText('Is ceramic really more durable?')).not.toBeVisible()
  })

  it('lists only the fields an avatar has', async () => {
    await renderLoaded([makeAvatar('p1', 'Plain One', { primaryProblems: ['Logo tax'] })])
    const c = within(card('Plain One'))

    await userEvent.click(c.getByRole('button', { name: /View details/ }))

    expect(c.getByText('Primary problems')).toBeVisible()
    expect(c.queryByText('Objections')).toBeNull()
    expect(c.queryByText('Ad concepts')).toBeNull()
  })

  it('does not open from a click on the card itself, only from View details', async () => {
    await renderLoaded([rich])
    const c = within(card('The Chipped-Color Veteran'))

    await userEvent.click(c.getByRole('heading', { name: 'The Chipped-Color Veteran' }))
    await userEvent.click(c.getByText('Why it works for them'))

    expect(c.getByRole('button', { name: /View details/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('adds no heading inside a card besides the avatar name', async () => {
    await renderLoaded([rich])

    await userEvent.click(
      within(card('The Chipped-Color Veteran')).getByRole('button', { name: /View details/ }),
    )

    expect(within(card('The Chipped-Color Veteran')).getAllByRole('heading')).toHaveLength(1)
  })
})
