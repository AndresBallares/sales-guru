import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { analyzeWhenReady } from './support/axe'

// The app is a single-page app: right after goto() the document can still be an
// empty shell. Holding its scripts back makes that moment last exactly as long as the
// test wants. The scripts wait on a gate the test opens, not on a timer: a timer per script
// adds up across the chain of scripts the app loads and can outlast the assertion's timeout
// on a busy machine (it did, 2026-11-04).
async function openLoginWithScriptsHeldBack(page: Page) {
  let openGate: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (openGate = resolve))
  await page.route('**/assets/*.js', async (route) => {
    await gate
    await route.continue()
  })
  await page.goto('/login', { waitUntil: 'commit' })
  return openGate
}

test('axe run straight after navigation sees an unrendered page (the race)', async ({ page }) => {
  const releaseScripts = await openLoginWithScriptsHeldBack(page)
  const results = await new AxeBuilder({ page }).analyze()
  releaseScripts()
  expect(results.violations.map((v) => v.id)).toContain('landmark-one-main')
})

test('analyzeWhenReady waits for the page to render before running axe', async ({ page }) => {
  const releaseScripts = await openLoginWithScriptsHeldBack(page)
  const analysis = analyzeWhenReady(page)
  // Still an empty shell while the scripts are held: nothing to scan yet.
  await expect(page.locator('main')).toHaveCount(0)
  releaseScripts()
  expect((await analysis).violations).toEqual([])
})
