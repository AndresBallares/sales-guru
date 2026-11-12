import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CampaignTypeOptions } from '../lib/api'
import * as api from '../lib/api'
import { CampaignTypePicker } from './CampaignTypePicker'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    getCampaignTypes: vi.fn<typeof actual.getCampaignTypes>(),
  }
})
const mockedApi = vi.mocked(api)

const CREATIVE = '4 ads per round, up to 3 rounds, budget moves to the winners.'
const DATA_DRIVEN =
  'Uses your account history to choose audiences; 4 ads per round, up to 3 rounds, budget moves to the winners.'

const SALES_OPTIONS: CampaignTypeOptions = {
  recommended: 'CREATIVE_TEST',
  options: [
    {
      type: 'CREATIVE_TEST',
      label: 'Creative Test',
      description: CREATIVE,
      available: true,
      reason: null,
      warning: null,
    },
    {
      type: 'DATA_DRIVEN',
      label: 'Data-Driven',
      description: DATA_DRIVEN,
      available: true,
      reason: null,
      warning: null,
    },
    {
      type: 'STANDARD',
      label: 'Standard',
      description: 'One ad set with its own budget. Allows 1 to 4 ads and no rounds.',
      available: true,
      reason: null,
      warning: 'A standard campaign keeps its budget on the ad set and cannot run rounds.',
    },
    {
      type: 'GEO',
      label: 'Geo Targeting',
      description: 'Reach people at one venue or event with a small radius.',
      available: false,
      reason: 'Geo Targeting is coming soon.',
      warning: null,
    },
  ],
}

beforeEach(() => {
  mockedApi.getCampaignTypes.mockReset()
  mockedApi.getCampaignTypes.mockResolvedValue(SALES_OPTIONS)
})

function renderPicker(value: api.CampaignType | undefined, onChange = vi.fn<(type: api.CampaignType) => void>()) {
  render(
    <CampaignTypePicker businessId="biz-1" campaignId="camp-1" value={value} onChange={onChange} />,
  )
  return onChange
}

describe('CampaignTypePicker', () => {
  it('is a native dropdown named Campaign type with every type in it', async () => {
    renderPicker('CREATIVE_TEST')

    const select = await screen.findByRole('combobox', {
      name: 'Campaign type',
    })
    expect(select.tagName).toBe('SELECT')
    const names = screen.getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual([
      'Creative Test (recommended)',
      'Data-Driven',
      'Standard',
      'Geo Targeting — coming soon',
    ])
  })

  it('preselects the recommendation when nothing was chosen yet', async () => {
    const onChange = renderPicker(undefined)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('CREATIVE_TEST'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('preselects Data-Driven when the account has history', async () => {
    mockedApi.getCampaignTypes.mockResolvedValue({
      ...SALES_OPTIONS,
      recommended: 'DATA_DRIVEN',
    })
    const onChange = renderPicker(undefined)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('DATA_DRIVEN'))
  })

  it('never overrides a choice the user already made', async () => {
    const onChange = renderPicker('STANDARD')

    await screen.findByRole('combobox', { name: 'Campaign type' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the one-line description of the selected type', async () => {
    renderPicker('DATA_DRIVEN')

    expect(await screen.findByText(DATA_DRIVEN)).toBeInTheDocument()
    expect(screen.queryByText(CREATIVE)).not.toBeInTheDocument()
  })

  it('lets the user pick another available type', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker('CREATIVE_TEST')

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Campaign type' }),
      'DATA_DRIVEN',
    )

    expect(onChange).toHaveBeenCalledWith('DATA_DRIVEN')
  })

  it('shows Geo Targeting but does not let it be picked', async () => {
    renderPicker('CREATIVE_TEST')

    const geo = await screen.findByRole('option', { name: /Geo Targeting/ })
    expect(geo).toBeDisabled()
  })

  it('warns that a standard campaign cannot run rounds', async () => {
    renderPicker('STANDARD')

    expect(await screen.findByRole('note')).toHaveTextContent(/cannot run rounds/i)
  })

  it('shows no warning for the round-based types', async () => {
    renderPicker('CREATIVE_TEST')

    await screen.findByRole('combobox', { name: 'Campaign type' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('says why a type is unavailable for another objective', async () => {
    mockedApi.getCampaignTypes.mockResolvedValue({
      recommended: 'LEGACY_AUDIENCE_TEST',
      options: [
        {
          type: 'CREATIVE_TEST',
          label: 'Creative Test',
          description: CREATIVE,
          available: false,
          reason: 'This campaign type is only available for the Sales objective.',
          warning: null,
        },
        {
          type: 'LEGACY_AUDIENCE_TEST',
          label: 'Audience test',
          description: 'Compares a broad audience with an interest audience.',
          available: true,
          reason: null,
          warning: null,
        },
      ],
    })
    renderPicker('LEGACY_AUDIENCE_TEST')

    const creative = await screen.findByRole('option', {
      name: /Creative Test/,
    })
    expect(creative).toBeDisabled()
    expect(creative).toHaveTextContent(/only available for the Sales objective/)
  })

  it('reports a failed load instead of showing an empty dropdown', async () => {
    mockedApi.getCampaignTypes.mockRejectedValue(new api.ApiError(500, 'boom'))
    renderPicker(undefined)

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load the campaign types/i)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
