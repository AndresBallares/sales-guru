import { test, expect, type Page } from '@playwright/test'
import { finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'
import { E2E_API_URL } from './support/ports'

// A creative test (a cold-start SALES campaign) written to a library of buyer avatars. FAKE_LLM
// (see playwright.config.ts) answers with canned angles spread over the avatars, so no model call
// is made: each creative card then names the avatar it was written for, with its concept and
// pillar. Without a library the cards keep the self-purchaser / gift-buyer label.

const AVATARS = [
  { name: 'The Promotion Ring Buyer', purchaseFor: 'self' },
  { name: 'The Deadline Gift-Giver', purchaseFor: 'gift' },
  { name: 'The Heirloom Commissioner', purchaseFor: 'self' },
]

async function reachCreativeCards(page: Page, avatars: typeof AVATARS) {
  await reachMetaPixelStep(page)
  await page.getByLabel('Meta Pixel').selectOption({ value: 'fake_pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await finishOnboarding(page, { objectiveLabel: 'Sales' })

  const businessId = page.url().match(/businesses\/([^/?#]+)/)?.[1]
  expect(businessId).toBeTruthy()
  for (const avatar of avatars) {
    const response = await page.request.post(`${E2E_API_URL}/businesses/${businessId}/avatars`, {
      data: { ...avatar, who: `${avatar.name} buys fine jewelry.` },
    })
    expect(response.ok()).toBeTruthy()
  }

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(page.getByText('Has this business run advertising campaigns before?')).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText(/Creative test/)).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  await expect(page.getByText('0 of 3–4 ads selected')).toBeVisible()
  const lines = page.locator('.creative-card-angle')
  await expect.poll(() => lines.count()).toBeGreaterThanOrEqual(3)
  return lines.allTextContents()
}

test('creative cards name the buyer avatar, and pass the axe checks', async ({ page }) => {
  const lines = await reachCreativeCards(page, AVATARS)

  for (const line of lines) {
    // "<avatar name> – <Concept> – <Pillar>", never just "Self-purchaser – ..."
    expect(AVATARS.some((a) => line.startsWith(`${a.name} – `))).toBe(true)
    expect(line).not.toMatch(/^(Self-purchaser|Gift buyer) – /)
  }
  // The library has a gift avatar and self avatars, and the test covers more than one.
  expect(new Set(lines.map((l) => l.split(' – ')[0])).size).toBeGreaterThanOrEqual(2)

  const results = await analyzeWhenReady(page, WCAG_TAGS)
  expect(results.violations).toEqual([])
})

test('a creative card with no library avatar keeps the self-purchaser / gift-buyer label', async ({
  page,
}) => {
  const lines = await reachCreativeCards(page, [])

  for (const line of lines) {
    expect(line).toMatch(/^(Self-purchaser|Gift buyer) – /)
    expect(line).not.toMatch(/archived|inactive/)
  }
})
