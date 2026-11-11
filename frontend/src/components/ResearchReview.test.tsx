import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchReview } from './ResearchReview'
import * as api from '../lib/api'
import { makeAvatarDraft, makeRun } from '../test/researchFixtures'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    bulkCreateAvatars: vi.fn<typeof actual.bulkCreateAvatars>(),
    discardResearchRun: vi.fn<typeof actual.discardResearchRun>(),
    markResearchRunDone: vi.fn<typeof actual.markResearchRunDone>(),
  }
})
const mockedApi = vi.mocked(api)

function existing(name: string, id = `id-${name}`): api.BuyerAvatar {
  return {
    id,
    businessId: 'biz-1',
    name,
    who: 'w',
    purchaseFor: 'self',
    primaryProblems: [],
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
}

function renderReview(
  run: api.ResearchRun = makeRun(),
  library: api.BuyerAvatar[] = [existing('The Promotion Ring Buyer')],
) {
  const onSaved = vi.fn<(created: api.BuyerAvatar[]) => void>()
  const onDiscarded = vi.fn<() => void>()
  const onBack = vi.fn<() => void>()
  const onDone = vi.fn<() => void>()
  const onOpenAvatar = vi.fn<(id: string) => void>()
  render(
    <MemoryRouter>
      <ResearchReview
        businessId="biz-1"
        run={run}
        library={library}
        onSaved={onSaved}
        onDiscarded={onDiscarded}
        onDone={onDone}
        onOpenAvatar={onOpenAvatar}
        onBack={onBack}
      />
    </MemoryRouter>,
  )
  return { onSaved, onDiscarded, onBack, onDone, onOpenAvatar }
}

function draft(name: string) {
  return screen.getByRole('listitem', { name })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedApi.bulkCreateAvatars.mockResolvedValue([])
  mockedApi.discardResearchRun.mockResolvedValue(makeRun({ status: 'DISCARDED' }))
  mockedApi.markResearchRunDone.mockResolvedValue(makeRun({ status: 'REVIEWED' }))
})
afterEach(() => vi.restoreAllMocks())

describe('evidence', () => {
  it('shows the customer-voice sources against the minimum', () => {
    renderReview()
    const banner = screen.getByRole('region', { name: 'Evidence' })
    expect(banner).toHaveTextContent('8 customer-voice sources reached')
    expect(banner).toHaveTextContent('minimum for a standard run: 6')
    expect(within(banner).queryByText('Low evidence')).not.toBeInTheDocument()
  })

  it('warns prominently, with the reason, when the evidence is low', () => {
    renderReview(
      makeRun({
        evidenceLevel: 'LOW',
        customerVoiceSources: 2,
        evidenceReason: 'Reached 2 customer-voice sources; a standard run needs at least 6.',
      }),
    )
    const banner = screen.getByRole('region', { name: 'Evidence' })
    expect(within(banner).getByText('Low evidence')).toBeInTheDocument()
    expect(banner).toHaveTextContent('a standard run needs at least 6')
  })

  it('shows the coverage note, warnings and a note when the run stopped early', () => {
    const run = makeRun({ stopReason: 'cap' })
    run.findings.warnings = ['2 quote(s) were not found on their page and were removed.']
    renderReview(run)
    expect(screen.getByText(/Reached 12 of 14 linked pages/)).toBeInTheDocument()
    expect(screen.getByText(/2 quote\(s\) were not found/)).toBeInTheDocument()
    expect(screen.getByText(/stopped before it finished/i)).toBeInTheDocument()
  })
})

describe('page order and the avatar count', () => {
  it('puts the AI Customer Avatars before every research section', () => {
    renderReview()
    const avatars = screen.getByRole('heading', { name: 'AI Customer Avatars' })
    for (const name of [/^Market Opportunities$/, /^Gaps Nobody Solves Yet$/, /^Problems identified/, /^Proposed solutions/, /^Evidence$/]) {
      const later = screen.getByRole('heading', { name })
      expect(avatars.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // The summary cards come first, then the avatars.
    const cards = screen.getByRole('list', { name: 'Research summary' })
    expect(cards.compareDocumentPosition(avatars) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the same avatar count on the fifth card and in the section', () => {
    renderReview()
    const drafts = within(screen.getByRole('list', { name: 'Avatar drafts' })).getAllByRole('listitem')
    expect(screen.getByRole('button', { name: new RegExp(`^${drafts.length} AI Customer Avatars`) })).toBeInTheDocument()
    expect(screen.getByText(`${drafts.length} customer ${drafts.length === 1 ? 'avatar' : 'avatars'}`)).toBeInTheDocument()
  })
})

describe('problems, solutions and gaps', () => {
  it('labels quotes verified or unverified, marks inferred items and links sources', async () => {
    const user = userEvent.setup()
    renderReview()
    const list = screen.getByRole('list', { name: 'Problems' })
    const first = within(list).getAllByRole('listitem')[0]
    expect(first).toHaveTextContent('Plated jewelry fades within weeks.')
    // The proof is one click away, not on the page by default.
    expect(within(first).queryByText('Unverified')).not.toBeInTheDocument()
    await user.click(within(first).getByRole('button', { name: /View evidence/ }))
    expect(within(first).getByText('Verified')).toBeInTheDocument()
    expect(within(first).getByText('Unverified')).toBeInTheDocument()
    expect(within(first).getByText(/it turned my finger green/)).toBeInTheDocument()
    const link = within(first).getAllByRole('link', { name: /Source/ })[0]
    expect(link).toHaveAttribute('href', 'https://www.reddit.com/r/jewelry/comments/1/x')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    const second = within(list).getAllByRole('listitem')[1]
    expect(within(second).getByText('Inferred')).toBeInTheDocument()
  })

  it('shows solutions with the problems they solve, and gaps', () => {
    renderReview()
    const solutions = screen.getByRole('list', { name: 'Solutions' })
    expect(within(solutions).getAllByRole('listitem')[0]).toHaveTextContent('Solves problem 1')
    const gaps = screen.getByRole('list', { name: 'Gaps' })
    expect(within(gaps).getByText('Free resizing for life')).toBeInTheDocument()
  })
})

describe('avatar drafts', () => {
  it('starts with nothing selected and counts the library slots', () => {
    renderReview()
    expect(screen.getByText(/1 of 12 avatar slots used; 11 left/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Save The Plain-Gold Loyalist/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save selected' })).toBeDisabled()
  })

  it('fills every field from the run, resolving problem and solution numbers to text', () => {
    renderReview()
    const item = draft('The Plain-Gold Loyalist')
    expect(within(item).getByLabelText('Name')).toHaveValue('The Plain-Gold Loyalist')
    expect(within(item).getByLabelText('Who they are')).toHaveValue('The Plain-Gold Loyalist buys fine jewelry.')
    expect(within(item).getByLabelText('Who they buy for')).toHaveValue('self')
    expect(within(item).getByLabelText('Primary problems')).toHaveValue('Plated jewelry fades within weeks.')
    expect(within(item).getByLabelText('Mechanisms')).toHaveValue('Solid 18K')
    expect(within(item).getByLabelText('Hooks')).toHaveValue('The blue stays blue.')
    expect(within(item).getByLabelText('Concept 1 name')).toHaveValue('The Sanitizer Test')
    expect(within(item).getByLabelText('Concept 1 pillar')).toHaveValue('mechanism')
    expect(within(item).getByLabelText('Concept 1 description')).toHaveValue('Shows it.')
  })

  it('marks inferred avatars', () => {
    renderReview()
    expect(within(draft('The Heirloom Buyer')).getByText('Inferred')).toBeInTheDocument()
    expect(within(draft('The Plain-Gold Loyalist')).queryByText('Inferred')).not.toBeInTheDocument()
  })

  it('warns about a name that is already in the library', () => {
    renderReview(makeRun(), [existing('the plain-gold loyalist')])
    expect(within(draft('The Plain-Gold Loyalist')).getByText(/already in your library/)).toBeInTheDocument()
    expect(within(draft('The Heirloom Buyer')).queryByText(/already in your library/)).not.toBeInTheDocument()
  })

  it('warns about two drafts with the same name', async () => {
    const user = userEvent.setup()
    renderReview()
    const name = within(draft('The Heirloom Buyer')).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'The Plain-Gold Loyalist')
    expect(screen.getAllByText(/same name as another draft/).length).toBeGreaterThan(0)
  })

  it('adds and removes concepts, up to five', async () => {
    const user = userEvent.setup()
    renderReview()
    const item = draft('The Plain-Gold Loyalist')
    for (let n = 0; n < 4; n += 1) await user.click(within(item).getByRole('button', { name: 'Add a concept' }))
    expect(within(item).getByLabelText('Concept 5 name')).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: 'Add a concept' })).not.toBeInTheDocument()
    await user.click(within(item).getByRole('button', { name: 'Remove concept 5' }))
    expect(within(item).queryByLabelText('Concept 5 name')).not.toBeInTheDocument()
    expect(within(item).getByRole('button', { name: 'Add a concept' })).toBeInTheDocument()
  })
})

describe('saving', () => {
  it('saves the selected, edited avatars in one request tied to the run', async () => {
    const user = userEvent.setup()
    const { onSaved } = renderReview()
    const loyalist = draft('The Plain-Gold Loyalist')
    await user.click(within(loyalist).getByRole('checkbox', { name: /Save/ }))
    await user.clear(within(loyalist).getByLabelText('Name'))
    await user.type(within(loyalist).getByLabelText('Name'), 'Plain Gold Loyalist')
    await user.selectOptions(within(loyalist).getByLabelText('Who they buy for'), 'gift')
    await user.type(within(loyalist).getByLabelText('Hooks'), '{Enter}A second hook')
    await user.clear(within(loyalist).getByLabelText('Concept 1 description'))
    await user.type(within(loyalist).getByLabelText('Concept 1 description'), 'Edited line.')
    await user.click(within(draft('The Heirloom Buyer')).getByRole('checkbox', { name: /Save/ }))
    mockedApi.bulkCreateAvatars.mockResolvedValue([existing('Plain Gold Loyalist')])

    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save selected' }))

    expect(mockedApi.bulkCreateAvatars).toHaveBeenCalledTimes(1)
    const [businessId, drafts, research] = mockedApi.bulkCreateAvatars.mock.calls[0]
    expect(businessId).toBe('biz-1')
    // The request says which drafts of the run these are, so each can be saved once.
    expect(research).toEqual({ runId: 'run-1', draftIndexes: [0, 2] })
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({
      name: 'Plain Gold Loyalist',
      purchaseFor: 'gift',
      primaryProblems: ['Plated jewelry fades within weeks.'],
      mechanisms: ['Solid 18K'],
      hooks: ['The blue stays blue.', 'A second hook'],
      concepts: [{ name: 'The Sanitizer Test', pillar: 'mechanism', description: 'Edited line.' }],
    })
    expect(drafts[1].name).toBe('The Heirloom Buyer')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('leaves out a concept row with no name or description', async () => {
    const user = userEvent.setup()
    renderReview()
    const item = draft('The Plain-Gold Loyalist')
    await user.click(within(item).getByRole('checkbox', { name: /Save/ }))
    await user.click(within(item).getByRole('button', { name: 'Add a concept' }))
    await user.click(screen.getByRole('button', { name: 'Save selected' }))
    expect(mockedApi.bulkCreateAvatars.mock.calls[0][1][0].concepts).toHaveLength(1)
  })

  it('shows the server error beside the form and keeps every edit', async () => {
    const user = userEvent.setup()
    mockedApi.bulkCreateAvatars.mockRejectedValue(
      new api.ApiError(422, 'Hooks: Each entry must be at most 200 characters'),
    )
    const { onSaved } = renderReview()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    await user.click(screen.getByRole('button', { name: 'Save selected' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Each entry must be at most 200 characters')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Save The Plain-Gold Loyalist/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save selected' })).toBeEnabled()
  })

  it('does not let more avatars be saved than the library has room for', async () => {
    const user = userEvent.setup()
    const library = Array.from({ length: 11 }, (_, n) => existing(`Existing ${n}`))
    renderReview(makeRun(), library)
    expect(screen.getByText(/11 of 12 avatar slots used; 1 left/)).toBeInTheDocument()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    expect(screen.getByRole('button', { name: 'Save selected' })).toBeEnabled()
    await user.click(within(draft('The Heirloom Buyer')).getByRole('checkbox', { name: /Save/ }))
    expect(screen.getByRole('button', { name: 'Save selected' })).toBeDisabled()
    expect(screen.getByText(/only 1 slot left/i)).toBeInTheDocument()
  })
})

describe('competitor terms', () => {
  it('lists the terms in use and the ignored common words', () => {
    renderReview()
    const terms = screen.getByRole('list', { name: 'Competitor terms' })
    expect(within(terms).getByText('Cartier')).toBeInTheDocument()
    expect(screen.getByText(/Ignored as common words: Spur/)).toBeInTheDocument()
  })

  it('flags a hook that contains a listed term, and clears the flag when the term is removed', async () => {
    const user = userEvent.setup()
    renderReview()
    const item = draft('The Mother Passing It Forward')
    expect(within(item).getByText(/Contains a competitor term: Cartier/)).toBeInTheDocument()
    expect(within(draft('The Plain-Gold Loyalist')).queryByText(/Contains a competitor term/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove term Cartier' }))
    expect(within(item).queryByText(/Contains a competitor term/)).not.toBeInTheDocument()
  })

  it('flags angles and concepts for a term the owner adds', async () => {
    const user = userEvent.setup()
    renderReview()
    await user.type(screen.getByLabelText('Add a competitor term'), 'sanitizer')
    await user.click(screen.getByRole('button', { name: 'Add term' }))
    expect(within(draft('The Plain-Gold Loyalist')).getByText(/Contains a competitor term: sanitizer/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Add a competitor term'), 'day in the life{Enter}')
    expect(within(draft('The Heirloom Buyer')).getByText(/Contains a competitor term:.*day in the life/)).toBeInTheDocument()
  })

  it('lets the owner add an ignored common word back, so it is flagged again', async () => {
    const user = userEvent.setup()
    const run = makeRun({ ignoredCompetitorTerms: ['Coach'] })
    run.findings.avatars = [
      makeAvatarDraft('The Gifter', { hooks: ['Coach your way to a better gift'] }),
    ]
    renderReview(run)
    const item = draft('The Gifter')
    expect(within(item).queryByText(/Contains a competitor term/)).not.toBeInTheDocument()
    expect(screen.getByText(/Ignored as common words: Coach/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Add a competitor term'), 'Coach{Enter}')
    expect(within(item).getByText(/Contains a competitor term: Coach/)).toBeInTheDocument()
  })

  it('ignores a blank or repeated term', async () => {
    const user = userEvent.setup()
    renderReview()
    await user.click(screen.getByRole('button', { name: 'Add term' }))
    await user.type(screen.getByLabelText('Add a competitor term'), 'cartier{Enter}')
    expect(screen.getAllByRole('button', { name: /Remove term/ })).toHaveLength(1)
  })
})

describe('discarding', () => {
  it('asks first, then ends the review without saving', async () => {
    const user = userEvent.setup()
    const { onDiscarded } = renderReview()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByText(/Nothing will be saved/)).toBeInTheDocument()
    expect(mockedApi.discardResearchRun).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Yes, discard' }))
    expect(mockedApi.discardResearchRun).toHaveBeenCalledWith('biz-1', 'run-1')
    await waitFor(() => expect(onDiscarded).toHaveBeenCalled())
    expect(mockedApi.bulkCreateAvatars).not.toHaveBeenCalled()
  })

  it('can be canceled', async () => {
    const user = userEvent.setup()
    renderReview()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await user.click(screen.getByRole('button', { name: 'Keep reviewing' }))
    expect(screen.queryByText(/Nothing will be saved/)).not.toBeInTheDocument()
  })

  it('shows a failure to discard', async () => {
    const user = userEvent.setup()
    mockedApi.discardResearchRun.mockRejectedValue(new api.ApiError(409, 'Only a run waiting for review can be discarded'))
    renderReview()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await user.click(screen.getByRole('button', { name: 'Yes, discard' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a run waiting for review')
  })
})

describe('unsaved edits', () => {
  function leave(): Event {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event
  }

  it('does not warn before anything is changed', () => {
    renderReview()
    expect(leave().defaultPrevented).toBe(false)
  })

  it.each([
    ['a checkbox', async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    }],
    ['an avatar edit', async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(within(draft('The Plain-Gold Loyalist')).getByLabelText('Hooks'), ' more')
    }],
    ['a term-list edit', async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Remove term Cartier' }))
    }],
  ])('warns before leaving after %s', async (_label, change) => {
    const user = userEvent.setup()
    renderReview()
    await change(user)
    expect(leave().defaultPrevented).toBe(true)
  })

  it('stops warning once the edit is undone', async () => {
    const user = userEvent.setup()
    renderReview()
    const box = within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ })
    await user.click(box)
    await user.click(box)
    expect(leave().defaultPrevented).toBe(false)
  })

  it('stops warning after saving', async () => {
    const user = userEvent.setup()
    renderReview()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    await user.click(screen.getByRole('button', { name: 'Save selected' }))
    await waitFor(() => expect(mockedApi.bulkCreateAvatars).toHaveBeenCalled())
    await waitFor(() => expect(leave().defaultPrevented).toBe(false))
  })

  it('asks before following a link out of the page, and stays if the owner says no', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = render(<a href="/elsewhere">Home</a>)
    renderReview()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    container.querySelector('a')!.dispatchEvent(click)
    expect(confirm).toHaveBeenCalled()
    expect(click.defaultPrevented).toBe(true)
  })

  it('does not ask about a link that stays on the page', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = render(<a href="#products">Products</a>)
    renderReview()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    fireEvent.click(container.querySelector('a')!)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks before going back with unsaved edits', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { onBack } = renderReview()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    await user.click(screen.getByRole('button', { name: 'Back to avatars' }))
    expect(confirm).toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Back to avatars' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('goes back without asking when nothing changed', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm')
    const { onBack } = renderReview()
    await user.click(screen.getByRole('button', { name: 'Back to avatars' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(onBack).toHaveBeenCalled()
  })
})

describe('saving more than once from the same run', () => {
  const savedFirst = () =>
    makeRun({ savedAvatarIds: ['lib-1'], savedDrafts: [{ draftIndex: 0, avatarId: 'lib-1' }] })
  const libraryWithFirst = () => [
    existing('The Promotion Ring Buyer'),
    existing('The Plain-Gold Loyalist', 'lib-1'),
  ]

  it('shows an avatar already saved from this run as Saved, with a link to its library entry', async () => {
    const user = userEvent.setup()
    const { onOpenAvatar } = renderReview(savedFirst(), libraryWithFirst())
    const item = draft('The Plain-Gold Loyalist')
    expect(within(item).getByText('Saved')).toBeInTheDocument()
    expect(within(item).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(item).queryByText('View persona details')).not.toBeInTheDocument()
    const link = within(item).getByRole('link', { name: /View The Plain-Gold Loyalist in your library/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('avatar=lib-1'))
    await user.click(link)
    expect(onOpenAvatar).toHaveBeenCalledWith('lib-1')
    // The other drafts can still be picked.
    expect(within(draft('The Heirloom Buyer')).getByRole('checkbox', { name: /Save/ })).toBeEnabled()
  })

  it('counts only drafts still to save as selectable', () => {
    renderReview(savedFirst(), libraryWithFirst())
    expect(screen.getByRole('region', { name: 'AI Customer Avatars' })).toHaveTextContent('1 saved from this research')
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  it('saves the avatars it is asked to, then marks them Saved and stays open for more', async () => {
    const user = userEvent.setup()
    const { onSaved, onDone } = renderReview()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    mockedApi.bulkCreateAvatars.mockResolvedValueOnce([existing('The Plain-Gold Loyalist', 'new-1')])
    await user.click(screen.getByRole('button', { name: 'Save selected' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    const item = draft('The Plain-Gold Loyalist')
    expect(within(item).getByText('Saved')).toBeInTheDocument()
    expect(within(item).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
    // Pick a third and save again: only the new draft is sent.
    await user.click(within(draft('The Heirloom Buyer')).getByRole('checkbox', { name: /Save/ }))
    mockedApi.bulkCreateAvatars.mockResolvedValueOnce([existing('The Heirloom Buyer', 'new-2')])
    await user.click(screen.getByRole('button', { name: 'Save selected' }))
    await waitFor(() => expect(mockedApi.bulkCreateAvatars).toHaveBeenCalledTimes(2))
    expect(mockedApi.bulkCreateAvatars.mock.calls[1][1]).toHaveLength(1)
    expect(mockedApi.bulkCreateAvatars.mock.calls[1][2]).toEqual({ runId: 'run-1', draftIndexes: [2] })
  })

  it('sends one request for a double click on Save selected', async () => {
    const user = userEvent.setup()
    let finish: (created: api.BuyerAvatar[]) => void = () => undefined
    mockedApi.bulkCreateAvatars.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderReview()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    await user.dblClick(screen.getByRole('button', { name: 'Save selected' }))
    expect(mockedApi.bulkCreateAvatars).toHaveBeenCalledTimes(1)
    finish([existing('The Plain-Gold Loyalist', 'new-1')])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save selected' })).toBeDisabled())
  })

  it('shows the server message when a draft was already saved elsewhere, and keeps the picks', async () => {
    const user = userEvent.setup()
    mockedApi.bulkCreateAvatars.mockRejectedValue(
      new api.ApiError(409, 'One of these drafts was already saved to your library. Reload the research to see which.'),
    )
    renderReview()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    await user.click(screen.getByRole('button', { name: 'Save selected' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already saved')
    expect(screen.getByRole('checkbox', { name: /Save The Plain-Gold Loyalist/ })).toBeChecked()
  })

  it('does not warn about leaving once what was picked is saved', async () => {
    const user = userEvent.setup()
    renderReview()
    await user.click(within(draft('The Plain-Gold Loyalist')).getByRole('checkbox', { name: /Save/ }))
    await user.type(within(draft('The Plain-Gold Loyalist')).getByLabelText('Hooks'), ' more')
    await user.click(screen.getByRole('button', { name: 'Save selected' }))
    await waitFor(() => expect(mockedApi.bulkCreateAvatars).toHaveBeenCalled())
    const event = new Event('beforeunload', { cancelable: true })
    await waitFor(() => {
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })
  })

  it('does not count a saved avatar against the slots left twice', () => {
    renderReview(savedFirst(), libraryWithFirst())
    expect(screen.getByText(/2 of 12 avatar slots used; 10 left/)).toBeInTheDocument()
  })
})

describe('marking the review as done', () => {
  const withSaved = () =>
    makeRun({ savedAvatarIds: ['lib-1'], savedDrafts: [{ draftIndex: 0, avatarId: 'lib-1' }] })
  const lib = () => [existing('The Plain-Gold Loyalist', 'lib-1')]

  it('is offered only once something was saved, and Discard goes away', () => {
    renderReview(makeRun(), [])
    expect(screen.queryByRole('button', { name: 'Mark as done' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('replaces Discard with Mark as done after something was saved', () => {
    renderReview(withSaved(), lib())
    expect(screen.getByRole('button', { name: 'Mark as done' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
  })

  it('asks first, says no more can be saved afterwards, then finishes the review', async () => {
    const user = userEvent.setup()
    const { onDone } = renderReview(withSaved(), lib())
    await user.click(screen.getByRole('button', { name: 'Mark as done' }))
    expect(screen.getByText(/no more avatars can be saved/i)).toBeInTheDocument()
    expect(mockedApi.markResearchRunDone).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Yes, mark as done' }))
    expect(mockedApi.markResearchRunDone).toHaveBeenCalledWith('biz-1', 'run-1')
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('can be cancelled', async () => {
    const user = userEvent.setup()
    renderReview(withSaved(), lib())
    await user.click(screen.getByRole('button', { name: 'Mark as done' }))
    await user.click(screen.getByRole('button', { name: 'Keep reviewing' }))
    expect(screen.queryByText(/no more avatars can be saved/i)).not.toBeInTheDocument()
  })

  it('warns that unsaved picks are lost', async () => {
    const user = userEvent.setup()
    renderReview(withSaved(), lib())
    await user.click(within(draft('The Heirloom Buyer')).getByRole('checkbox', { name: /Save/ }))
    await user.click(screen.getByRole('button', { name: 'Mark as done' }))
    expect(screen.getByText(/unsaved changes will be lost/i)).toBeInTheDocument()
  })

  it('shows a failure to finish', async () => {
    const user = userEvent.setup()
    mockedApi.markResearchRunDone.mockRejectedValue(new api.ApiError(409, 'Nothing was saved from this research. Discard it instead.'))
    const { onDone } = renderReview(withSaved(), lib())
    await user.click(screen.getByRole('button', { name: 'Mark as done' }))
    await user.click(screen.getByRole('button', { name: 'Yes, mark as done' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was saved')
    expect(onDone).not.toHaveBeenCalled()
  })
})

it('moves focus to the heading', async () => {
  renderReview()
  const heading = screen.getByRole('heading', { level: 2, name: 'Market Intelligence' })
  await waitFor(() => expect(heading).toHaveFocus())
})

it('works for a run that stopped early with nothing to review', () => {
  renderReview(makeRun({ findings: {}, coverageNote: null }))
  expect(screen.getByText(/no avatar drafts/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save selected' })).toBeDisabled()
  void makeAvatarDraft
})
