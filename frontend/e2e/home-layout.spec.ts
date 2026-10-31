import { test, expect, type Page } from '@playwright/test'
import { uniqueEmail } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'

// The signed-in home page at phone and desktop widths. Set SCREENSHOT_DIR to also save a
// picture of each case (used for the pull request; nothing is saved by default).
const WIDTHS = [320, 390, 1280]
const LONG_EMAIL = () => uniqueEmail().replace('@', '.with.a.very.long.address@')

async function signUpAndAddBusiness(page: Page, email: string) {
  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('supersecret123')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible()
  await page.getByLabel('Name').fill('VENZI JEWELRY')
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByLabel('Location').fill('New York')
  await page.getByRole('button', { name: 'Save Business' }).click()
  await expect(page.getByRole('link', { name: 'VENZI JEWELRY' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Brand DNA' })).toBeVisible()
}

type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

for (const width of WIDTHS) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`home page at ${width}px, ${scheme}: nothing overlaps or overflows`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: scheme })
      await signUpAndAddBusiness(page, LONG_EMAIL())
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' })

      // Header: logo, signed-in line, and the toggle with Log out, none on top of another.
      const logo = (await page.getByRole('heading', { name: 'Sales Guru' }).boundingBox())!
      const toggle = (await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).boundingBox())!
      const logout = (await page.getByRole('button', { name: 'Log out' }).boundingBox())!
      const who = (await page.locator('.dashboard-signed-in').boundingBox())!
      const email = page.locator('.dashboard-email')
      expect(overlaps(logo, toggle)).toBe(false)
      expect(overlaps(logo, logout)).toBe(false)
      expect(overlaps(toggle, logout)).toBe(false)
      expect(overlaps(who, toggle)).toBe(false)
      expect(overlaps(who, logout)).toBe(false)
      // The toggle sits left of Log out, both in the right half of the header row.
      expect(toggle.x + toggle.width).toBeLessThanOrEqual(logout.x)
      if (width < 721) {
        // Phone: the signed-in line is its own row beneath, full width, the email on its own line.
        expect(who.y).toBeGreaterThanOrEqual(logo.y + logo.height)
        const label = (await page.locator('.dashboard-signed-in > span:first-child').boundingBox())!
        const emailBox = (await email.boundingBox())!
        expect(emailBox.y).toBeGreaterThanOrEqual(label.y + label.height - 1)
        // A long address is cut with an ellipsis, and its full text is on hover.
        expect(await email.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
        expect(await email.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis')
      } else {
        // Desktop: one row.
        expect(Math.abs(who.y + who.height / 2 - (logo.y + logo.height / 2))).toBeLessThan(40)
      }
      expect(await email.getAttribute('title')).toContain('@')
      expect(await email.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none')

      // Company Information: Add, Edit and Delete as one group.
      const group = page.locator('.company-actions')
      const buttons = group.locator(':scope > button')
      const names = await buttons.allInnerTexts()
      expect(names.map((n) => n.trim())).toEqual(['Add Business', 'Edit Business', 'Delete Business'])
      const boxes = (await buttons.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        }),
      )) as Box[]
      expect(new Set(boxes.map((b) => Math.round(b.height))).size).toBe(1)
      if (width < 721) {
        // Stacked, full width, equal gaps.
        const groupBox = (await group.boundingBox())!
        for (const b of boxes) {
          expect(Math.abs(b.x - groupBox.x)).toBeLessThanOrEqual(1)
          expect(Math.abs(b.width - groupBox.width)).toBeLessThanOrEqual(1)
        }
        const gaps = boxes.slice(1).map((b, i) => Math.round(b.y - (boxes[i].y + boxes[i].height)))
        expect(new Set(gaps).size).toBe(1)
      } else {
        // One row, left aligned, equal gaps.
        expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1)
        const groupBox = (await group.boundingBox())!
        expect(Math.abs(boxes[0].x - groupBox.x)).toBeLessThanOrEqual(1)
        const gaps = boxes.slice(1).map((b, i) => Math.round(b.x - (boxes[i].x + boxes[i].width)))
        expect(new Set(gaps).size).toBe(1)
      }

      // The business list: the name first, the industry and place together on one line below on a phone.
      const item = page.locator('.business-item').first()
      const name = (await item.locator('.business-item-name').boundingBox())!
      const meta = item.locator('.business-item-meta')
      await expect(meta).toHaveText('Fashion / Jewelry · New York')
      const metaBox = (await meta.boundingBox())!
      if (width < 721) {
        expect(metaBox.y).toBeGreaterThanOrEqual(name.y + name.height - 1)
        expect(Math.abs(metaBox.x - name.x)).toBeLessThanOrEqual(1)
        // One line, not wrapped: its height is a single line of small text.
        expect(metaBox.height).toBeLessThan(30)
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)

      if (process.env.SCREENSHOT_DIR) {
        await page.screenshot({
          path: `${process.env.SCREENSHOT_DIR}/home-${width}-${scheme}.png`,
          fullPage: true,
        })
      }
    })
  }
}

test('the home page passes the axe checks in light and dark', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await signUpAndAddBusiness(page, uniqueEmail())
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' })
    const axe = await analyzeWhenReady(page, WCAG_TAGS)
    expect(axe.violations).toEqual([])
  }
})

test('the theme toggle on the home page switches the theme', async ({ page }) => {
  await signUpAndAddBusiness(page, uniqueEmail())
  const html = page.locator('html')
  const before = await html.getAttribute('data-theme')

  await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click()

  await expect(html).not.toHaveAttribute('data-theme', before ?? '')
})
