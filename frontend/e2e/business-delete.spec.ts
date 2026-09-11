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
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  await expect(page.getByRole('button', { name: 'Publishing…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publishing…' })).not.toBeVisible()
  await expect(page.getByRole('alert')).not.toBeVisible()

  await page.getByRole('link', { name: '← Back to dashboard' }).click()
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
  await page.getByRole('button', { name: 'Pause campaign' }).click()
  await expect(page.getByText(/Live on Meta/)).not.toBeVisible()

  await deleteButton.click()
  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Acme Widgets' })).not.toBeVisible()
})
