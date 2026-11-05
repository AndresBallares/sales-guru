// The pause between two publish status checks, for tests of the background video publish.
//
// By default it is a real, tiny pause, so a test that only cares about the end result runs fast.
// A test that needs to look at an in-between status sets `hold`: every pause then waits until the
// test calls `release`, so the status on screen stays put (no timing involved) until the test is
// done with it. Call `reset` in `beforeEach` so one test's gate never leaks into the next.
export interface PublishPolls {
  hold: boolean
  held: (() => void)[]
  sleep: () => Promise<void>
  release: () => void
  reset: () => void
}

export function createPublishPolls(): PublishPolls {
  const polls: PublishPolls = {
    hold: false,
    held: [],
    sleep: () =>
      polls.hold
        ? new Promise<void>((resolve) => polls.held.push(resolve))
        : new Promise<void>((resolve) => setTimeout(resolve, 30)),
    release: () => polls.held.shift()?.(),
    reset: () => {
      polls.hold = false
      polls.held.length = 0
    },
  }
  return polls
}
