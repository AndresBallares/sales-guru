import { test, expect } from '@playwright/test'
import { uniqueEmail } from './support/fakeMetaFlow'

// A browser that lost its session (an iPhone that blocks the cross-site cookie) gets 401 from the
// authenticated /options endpoint. The Industry dropdown must say why it is empty and recover.
test('the Industry dropdown explains an empty list and fills once Try again works', async ({
  page,
}) => {
  await page.goto('/signup')
  await page.getByLabel('Email').fill(uniqueEmail())
  await page.getByLabel('Password').fill('supersecret123')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible()

  // The next load of the option lists is refused, as it would be without the session cookie.
  await page.route('**/options', (route) =>
    route.fulfill({ status: 401, json: { detail: 'Not authenticated' } }),
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible()

  const industry = page.getByLabel('Industry')
  await expect(industry).toBeVisible()
  expect(await industry.evaluate((el) => el.tagName)).toBe('SELECT')
  await expect(industry.locator('option')).toHaveCount(1)
  const field = page.locator('.field', { has: industry })
  await expect(field.getByRole('alert')).toContainText('not signed in')

  await page.unroute('**/options')
  await field.getByRole('button', { name: 'Try again' }).click()

  await expect.poll(async () => industry.locator('option').count()).toBeGreaterThan(5)
  await expect(field.getByRole('alert')).toHaveCount(0)
})
