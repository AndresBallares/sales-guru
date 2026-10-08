import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { describePublishStatus, waitForPublishJob } from './publishJob'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, getPublishStatus: vi.fn<typeof actual.getPublishStatus>() }
})
const mockedApi = vi.mocked(api)

const noWait = { intervalMs: 0, sleep: () => Promise.resolve() }

describe('waitForPublishJob', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('polls until the job is done, reporting each status', async () => {
    mockedApi.getPublishStatus
      .mockResolvedValueOnce({ state: 'PROCESSING', step: 'Uploading video' })
      .mockResolvedValueOnce({ state: 'PROCESSING', step: 'Processing video', progress: 40 })
      .mockResolvedValueOnce({ state: 'DONE' })
    const seen: api.PublishStatus[] = []

    await waitForPublishJob('b1', 'c1', (status) => seen.push(status), noWait)

    expect(mockedApi.getPublishStatus).toHaveBeenCalledTimes(3)
    expect(mockedApi.getPublishStatus).toHaveBeenCalledWith('b1', 'c1')
    expect(seen.map((s) => s.state)).toEqual(['PROCESSING', 'PROCESSING', 'DONE'])
  })

  it('waits between polls', async () => {
    mockedApi.getPublishStatus
      .mockResolvedValueOnce({ state: 'PROCESSING' })
      .mockResolvedValueOnce({ state: 'DONE' })
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined)

    await waitForPublishJob('b1', 'c1', () => undefined, { intervalMs: 2000, sleep })

    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('throws the job\'s own error message when it fails', async () => {
    mockedApi.getPublishStatus.mockResolvedValue({
      state: 'FAILED',
      error: 'Meta could not process the video: Unsupported codec',
    })

    await expect(
      waitForPublishJob('b1', 'c1', () => undefined, noWait),
    ).rejects.toThrow('Unsupported codec')
  })

  it('gives a generic message for a failure with no error text', async () => {
    mockedApi.getPublishStatus.mockResolvedValue({ state: 'FAILED' })

    await expect(
      waitForPublishJob('b1', 'c1', () => undefined, noWait),
    ).rejects.toThrow('Could not publish')
  })

  it('treats an IDLE status as finished (nothing is running)', async () => {
    mockedApi.getPublishStatus.mockResolvedValue({ state: 'IDLE' })

    await expect(
      waitForPublishJob('b1', 'c1', () => undefined, noWait),
    ).resolves.toBeUndefined()
  })

  it('keeps going through a brief network error while polling', async () => {
    mockedApi.getPublishStatus
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ state: 'DONE' })

    await expect(
      waitForPublishJob('b1', 'c1', () => undefined, noWait),
    ).resolves.toBeUndefined()
  })

  it('gives up after repeated network errors', async () => {
    mockedApi.getPublishStatus.mockRejectedValue(new Error('network'))

    await expect(
      waitForPublishJob('b1', 'c1', () => undefined, { ...noWait, maxConsecutiveErrors: 3 }),
    ).rejects.toThrow('Lost contact')
    expect(mockedApi.getPublishStatus).toHaveBeenCalledTimes(3)
  })
})

describe('describePublishStatus', () => {
  it('names the step and shows progress and time', () => {
    expect(
      describePublishStatus({
        state: 'PROCESSING',
        step: 'Processing video',
        progress: 40,
        elapsedSeconds: 75,
      }),
    ).toBe('Processing video… 40% (1:15)')
  })

  it('omits what it does not know', () => {
    expect(describePublishStatus({ state: 'PROCESSING', step: 'Uploading video' })).toBe(
      'Uploading video…',
    )
    expect(describePublishStatus({ state: 'PROCESSING' })).toBe('Publishing…')
  })
})
