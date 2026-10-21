import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { describeOptionsError, useOptions } from './useOptions'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, getOptions: vi.fn<typeof actual.getOptions>() }
})
const mockedApi = vi.mocked(api)

const loaded = {
  industries: [{ value: 'OTHER', label: 'Other' }],
  objectives: [],
  campaignStatuses: [],
  ctas: [],
  actionTypes: [],
  eventVenues: [],
  voiceTraits: [],
  pricePositionings: [],
} satisfies api.OptionsResponse

describe('useOptions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('loads the option lists', async () => {
    mockedApi.getOptions.mockResolvedValue(loaded)

    const { result } = renderHook(() => useOptions())

    await waitFor(() => expect(result.current.options).toEqual(loaded))
    expect(result.current.error).toBeNull()
  })

  it('says the browser is not signed in when the lists answer 401', async () => {
    mockedApi.getOptions.mockRejectedValue(new api.ApiError(401, 'Not authenticated'))

    const { result } = renderHook(() => useOptions())

    await waitFor(() => expect(result.current.error).toMatch(/not signed in/))
    expect(result.current.options).toBeNull()
  })

  it('gives a connection message for any other failure', async () => {
    mockedApi.getOptions.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useOptions())

    await waitFor(() => expect(result.current.error).toMatch(/Check your connection/))
  })

  it('loads again on retry and clears the error', async () => {
    mockedApi.getOptions.mockRejectedValueOnce(new api.ApiError(401, 'Not authenticated'))
    mockedApi.getOptions.mockResolvedValue(loaded)
    const { result } = renderHook(() => useOptions())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    act(() => result.current.retry())

    await waitFor(() => expect(result.current.options).toEqual(loaded))
    expect(result.current.error).toBeNull()
    expect(mockedApi.getOptions).toHaveBeenCalledTimes(2)
  })

  it('ignores a list that arrives after the component is gone', async () => {
    let resolve: (value: api.OptionsResponse) => void = () => {}
    mockedApi.getOptions.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result, unmount } = renderHook(() => useOptions())
    unmount()

    resolve(loaded)

    expect(result.current.options).toBeNull()
  })

  it('describes errors without exposing internals', () => {
    expect(describeOptionsError(new api.ApiError(500, 'boom'))).not.toMatch(/boom/)
  })
})
