import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { analyzeWhenReady } from './support/axe'

// The app is a single-page app: right after goto() the document can still be an
// empty shell. Slowing its scripts makes that moment last long enough to test.
async function openLoginWithSlowScripts(page: Page) {
  await page.route('**/assets/*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  })
  await page.goto('/login', { waitUntil: 'commit' })
}

test('axe run straight after navigation sees an unrendered page (the race)', async ({ page }) => {
  await openLoginWithSlowScripts(page)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.map((v) => v.id)).toContain('landmark-one-main')
})

test('analyzeWhenReady waits for the page to render before running axe', async ({ page }) => {
  await openLoginWithSlowScripts(page)
  const results = await analyzeWhenReady(page)
  expect(results.violations).toEqual([])
})
