import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarImportSection } from './AvatarImportSection'
import * as api from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    importAvatars: vi.fn<typeof actual.importAvatars>(),
    bulkCreateAvatars: vi.fn<typeof actual.bulkCreateAvatars>(),
  }
})
const mockedApi = vi.mocked(api)

function makeDraft(name: string, overrides: Partial<api.BuyerAvatarDraft> = {}): api.BuyerAvatarDraft {
  return {
    name,
    who: `${name} is someone who buys.`,
    primaryProblems: ['No idea what to buy', 'Needs it in time'],
    unknownProblems: [],
    mechanisms: ['Solid gold does not fade'],
    alternatives: ['Gift cards'],
    objections: [],
    hooks: ['Still time.'],
    creativeAngles: [],
    isActive: true,
    sortOrder: null,
    ...overrides,
  }
}

async function openAndImport(document = 'Some research about gift buyers.') {
  await userEvent.click(screen.getByText('Import buyer avatars from research'))
  await userEvent.type(screen.getByLabelText('Research document'), document)
  await userEvent.click(screen.getByRole('button', { name: 'Read document' }))
}

describe('AvatarImportSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('cannot read an empty document', async () => {
    render(<AvatarImportSection businessId="biz-1" />)
    await userEvent.click(screen.getByText('Import buyer avatars from research'))
    expect(screen.getByRole('button', { name: 'Read document' })).toBeDisabled()
  })

  it('shows the drafts and warnings, and saves nothing yet', async () => {
    mockedApi.importAvatars.mockResolvedValue({
      drafts: [makeDraft('Deadline Gift-Giver'), makeDraft('Collector')],
      warnings: ['No objections were given.'],
    })
    render(<AvatarImportSection businessId="biz-1" />)

    await openAndImport()

    expect(mockedApi.importAvatars).toHaveBeenCalledWith('biz-1', 'Some research about gift buyers.')
    expect(await screen.findByRole('article', { name: 'Deadline Gift-Giver' })).toBeVisible()
    expect(screen.getByRole('article', { name: 'Collector' })).toBeVisible()
    expect(screen.getByText('No objections were given.')).toBeVisible()
    expect(mockedApi.bulkCreateAvatars).not.toHaveBeenCalled()
  })

  it('saves only the checked drafts, with their edits', async () => {
    mockedApi.importAvatars.mockResolvedValue({
      drafts: [makeDraft('Deadline Gift-Giver'), makeDraft('Collector')],
      warnings: [],
    })
    mockedApi.bulkCreateAvatars.mockResolvedValue([])
    render(<AvatarImportSection businessId="biz-1" />)
    await openAndImport()
    const first = await screen.findByRole('article', { name: 'Deadline Gift-Giver' })

    const name = within(first).getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Last-minute giver')
    const problems = within(first).getByLabelText(/^Primary problems/)
    await userEvent.clear(problems)
    await userEvent.type(problems, 'First problem{enter}  {enter}Second problem')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Keep Collector' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 selected' }))

    expect(mockedApi.bulkCreateAvatars).toHaveBeenCalledTimes(1)
    const [businessId, avatars] = mockedApi.bulkCreateAvatars.mock.calls[0]
    expect(businessId).toBe('biz-1')
    expect(avatars).toHaveLength(1)
    expect(avatars[0].name).toBe('Last-minute giver')
    expect(avatars[0].primaryProblems).toEqual(['First problem', 'Second problem'])
    expect(avatars[0].hooks).toEqual(['Still time.'])
    expect(await screen.findByRole('status')).toHaveTextContent('Saved 1 avatar')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('cannot save with nothing checked', async () => {
    mockedApi.importAvatars.mockResolvedValue({ drafts: [makeDraft('Only one')], warnings: [] })
    render(<AvatarImportSection businessId="biz-1" />)
    await openAndImport()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Keep Only one' }))

    expect(screen.getByRole('button', { name: 'Save 0 selected' })).toBeDisabled()
  })

  it('shows why an import failed', async () => {
    mockedApi.importAvatars.mockRejectedValue(new api.ApiError(404, 'Avatar import is not enabled'))
    render(<AvatarImportSection businessId="biz-1" />)

    await openAndImport()

    expect(await screen.findByRole('alert')).toHaveTextContent('Avatar import is not enabled')
    expect(screen.getByRole('button', { name: 'Read document' })).toBeEnabled()
  })

  it('uses a generic message for an unexpected import failure', async () => {
    mockedApi.importAvatars.mockRejectedValue('boom')
    render(<AvatarImportSection businessId="biz-1" />)

    await openAndImport()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the document')
  })

  it('keeps the drafts and shows the reason when saving is refused', async () => {
    mockedApi.importAvatars.mockResolvedValue({ drafts: [makeDraft('Keeper')], warnings: [] })
    mockedApi.bulkCreateAvatars.mockRejectedValue(
      new api.ApiError(409, 'A business can hold at most 12 avatars'),
    )
    render(<AvatarImportSection businessId="biz-1" />)
    await openAndImport()

    await userEvent.click(await screen.findByRole('button', { name: 'Save 1 selected' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('at most 12 avatars')
    expect(screen.getByRole('article', { name: 'Keeper' })).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save 1 selected' })).toBeEnabled())
  })

  it('discards the drafts without saving', async () => {
    mockedApi.importAvatars.mockResolvedValue({ drafts: [makeDraft('Gone')], warnings: [] })
    render(<AvatarImportSection businessId="biz-1" />)
    await openAndImport()

    await userEvent.click(await screen.findByRole('button', { name: 'Discard drafts' }))

    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(mockedApi.bulkCreateAvatars).not.toHaveBeenCalled()
  })

  it('says so when the document held no avatars', async () => {
    mockedApi.importAvatars.mockResolvedValue({ drafts: [], warnings: [] })
    render(<AvatarImportSection businessId="biz-1" />)

    await openAndImport()

    expect(await screen.findByText('No avatars were found in that document.')).toBeVisible()
  })

  it('names plural saves', async () => {
    mockedApi.importAvatars.mockResolvedValue({
      drafts: [makeDraft('A'), makeDraft('B')],
      warnings: [],
    })
    mockedApi.bulkCreateAvatars.mockResolvedValue([])
    render(<AvatarImportSection businessId="biz-1" />)
    await openAndImport()

    await userEvent.click(await screen.findByRole('button', { name: 'Save 2 selected' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved 2 avatars')
  })
})
