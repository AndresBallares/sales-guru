import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Regression coverage for a real bug found during manual mobile QA: the
// theme toggle used to be `position: fixed`, so on a small viewport it sat
// on top of the "Log out" button and covered form fields/buttons while
// scrolling. jsdom-based unit tests can't catch this class of bug at all —
// there's no real layout engine — so this lives here instead, against an
// actual browser at a phone-sized viewport.
test.use({ viewport: { width: 375, height: 667 } })

function uniqueEmail(): string {
  return `e2e-mobile-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

test.describe('mobile viewport', () => {
  test('the theme toggle never overlaps header content, and moves with the page instead of staying fixed', async ({
    page,
  }) => {
    const email = uniqueEmail()
    await page.goto('/signup')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('supersecret123')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

    const toggle = page.getByRole('button', { name: /Switch to (dark|light) mode/ })
    const logOut = page.getByRole('button', { name: 'Log out' })

    const toggleBoxBefore = await toggle.boundingBox()
    const logOutBox = await logOut.boundingBox()
    expect(toggleBoxBefore).not.toBeNull()
    expect(logOutBox).not.toBeNull()
    expect(intersects(toggleBoxBefore!, logOutBox!)).toBe(false)

    // If the toggle were still `position: fixed`, its viewport-relative
    // position would stay put after scrolling. In normal document flow it
    // scrolls away with the rest of the page. window.scrollBy (rather than
    // a simulated mouse wheel) scrolls reliably regardless of pointer
    // position or how tall the page happens to be.
    const scrolled = await page.evaluate(() => {
      const before = window.scrollY
      window.scrollBy(0, 600)
      return window.scrollY - before
    })
    expect(scrolled).toBeGreaterThan(50)

    const toggleBoxAfter = await toggle.boundingBox()
    expect(toggleBoxAfter).not.toBeNull()
    expect(toggleBoxAfter!.y).toBeLessThan(toggleBoxBefore!.y - 50)
  })

  test('key interactive controls meet the 44px minimum touch target', async ({ page }) => {
    const email = uniqueEmail()
    await page.goto('/signup')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('supersecret123')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

    for (const name of [/Switch to (dark|light) mode/, 'Log out', 'Create business']) {
      const box = await page.getByRole('button', { name }).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })

  test('the dashboard has no detectable accessibility violations at a phone width', async ({ page }) => {
    const email = uniqueEmail()
    await page.goto('/signup')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('supersecret123')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})
