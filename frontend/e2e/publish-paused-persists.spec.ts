import { test, expect } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'

// The "Publish paused" checkbox lives on two pages (the dashboard's campaign
// list and the ad page). The choice used to be separate React state on each, so
// unchecking it on one was lost on the other (and on any remount): a user who
// asked for a live publish got a paused one. It is now one remembered choice.
test('the Publish paused choice follows the user between the ad page and the dashboard', async ({
  page,
}) => {
  await signUpAndReachFakeMetaConnectedBusiness(page)
  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText('Creative angles:')).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  await page.getByRole('button', { name: 'Select this ad' }).first().click()

  // On the ad page: uncheck it (it starts checked).
  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const adPageCheckbox = page.getByLabel(/Publish paused/)
  await expect(adPageCheckbox).toBeChecked()
  await adPageCheckbox.uncheck()

  // Back on the dashboard the campaign's checkbox shows the same choice...
  await page.getByRole('link', { name: '← Back to dashboard' }).click()
  const dashboardCheckbox = page.getByLabel(/Publish paused/)
  await expect(dashboardCheckbox).toBeVisible()
  await expect(dashboardCheckbox).not.toBeChecked()

  // ...and publishing from there honours it.
  const publishRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/publish'),
  )
  await page.getByRole('button', { name: 'Approve & Publish' }).click()
  expect((await publishRequest).postDataJSON()).toEqual({ paused: false })
  await expect(page.getByText(/Live on Meta/)).toBeVisible()
})
