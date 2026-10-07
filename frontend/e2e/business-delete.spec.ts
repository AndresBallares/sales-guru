import { test, expect } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'

// Same fully-faked backend as fake-meta-publish.spec.ts (FAKE_META +
// FAKE_LLM, see playwright.config.ts) — no real Meta or Anthropic call
// anywhere here, so this runs in CI on every PR.

test('deleting a business is blocked while a campaign is live, and succeeds once it is paused', async ({
  page,
}) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(
    page.getByText('Has this business run advertising campaigns before?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText('Creative angles:')).toBeVisible()

  await page.getByRole('button', { name: 'Generate ads' }).click()
  await page.getByRole('button', { name: 'Select this ad' }).first().click()
  // The ad page publishes paused by default; this spec needs a LIVE campaign.
  // Let the page finish loading before touching the checkbox: its state is
  // local, so a re-render after the uncheck would silently put it back to
  // "paused" (that was the intermittent failure), then confirm it stuck.
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const publishPaused = page.getByLabel(/Publish paused/)
  await publishPaused.uncheck()
  await expect(publishPaused).not.toBeChecked()
  const publishRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/publish'),
  )
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  expect((await publishRequest).postDataJSON()).toEqual({ paused: false })
  // Wait for the publish to finish: once the campaign is live the publish
  // button is gone entirely. (The transient "Publishing…" label raced the
  // instant fake publish.)
  await expect(
    page.getByRole('button', { name: /Approve & Publish|Publishing…/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('alert')).not.toBeVisible()

  // Wait for the dashboard's campaign list to actually load (an explicit
  // state, not a longer timeout), then for the LIVE state it reports.
  const campaignsLoaded = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname.endsWith('/campaigns') &&
      response.ok(),
  )
  await page.getByRole('link', { name: '← Back to dashboard' }).click()
  await campaignsLoaded
  await expect(page.getByRole('heading', { name: 'Acme Widgets' })).toBeVisible()
  await expect(page.getByText(/Live on Meta/)).toBeVisible()

  // Blocked: the campaign is still LIVE.
  await page.getByRole('button', { name: 'Delete business' }).click()
  await page.getByLabel(/Acme Widgets/).fill('Acme Widgets')
  const deleteButton = page.getByRole('button', { name: 'Permanently delete business' })
  await expect(deleteButton).toBeEnabled()
  await deleteButton.click()
  await expect(
    page.getByText('Pause or end it before deleting this business.'),
  ).toBeVisible()
  // Still here — not navigated away by the failed attempt.
  await expect(page.getByRole('heading', { name: 'Acme Widgets' })).toBeVisible()

  // End the campaign, then the same confirmed delete goes through.
  // Wait for the pause itself to succeed and the LIVE state to go away
  // (the Pause button is gone) before trying the delete again.
  const paused = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/pause') &&
      response.ok(),
  )
  await page.getByRole('button', { name: 'Pause campaign' }).click()
  await paused
  await expect(page.getByRole('button', { name: 'Pause campaign' })).toHaveCount(0)
  await expect(page.getByText(/Live on Meta/)).not.toBeVisible()

  await deleteButton.click()
  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Acme Widgets' })).not.toBeVisible()
})
