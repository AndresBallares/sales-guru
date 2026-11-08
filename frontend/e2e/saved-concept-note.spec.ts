import { test, expect, type Page } from '@playwright/test'
import { finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'
import { E2E_API_URL } from './support/ports'

// A creative test written to avatars that have saved concepts. FAKE_LLM (see
// playwright.config.ts) builds its angles the way the real path does: an angle that reuses one
// of its avatar's saved concepts gets the stored pillar and is recorded as "from your avatar" when
// it is created. The ad cards then read that note from their angle, so it stays when the concept
// is edited or deleted later. No model call is made.

const AVATARS = [
  { name: 'The Promotion Ring Buyer', purchaseFor: 'self', concept: ['Nobody chose this', 'emotion'] },
  { name: 'The Deadline Gift-Giver', purchaseFor: 'gift', concept: ['Gift ready certified', 'education'] },
  { name: 'The Heirloom Commissioner', purchaseFor: 'self', concept: ['Worn then inherited', 'mechanism'] },
]

async function reachCreativeCards(page: Page, withConcepts: boolean) {
  await reachMetaPixelStep(page)
  await page.getByLabel('Meta Pixel').selectOption({ value: 'fake_pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await finishOnboarding(page, { objectiveLabel: 'Sales' })

  const businessId = page.url().match(/businesses\/([^/?#]+)/)?.[1]
  expect(businessId).toBeTruthy()
  const ids: string[] = []
  for (const avatar of AVATARS) {
    const response = await page.request.post(`${E2E_API_URL}/businesses/${businessId}/avatars`, {
      data: {
        name: avatar.name,
        purchaseFor: avatar.purchaseFor,
        who: `${avatar.name} buys fine jewelry.`,
        concepts: withConcepts
          ? [{ name: avatar.concept[0], pillar: avatar.concept[1], description: 'A saved idea.' }]
          : [],
      },
    })
    expect(response.ok()).toBeTruthy()
    ids.push(((await response.json()) as { id: string }).id)
  }

  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(page.getByText('Has this business run advertising campaigns before?')).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText(/Creative test/)).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  await expect(page.getByText('0 of 3–4 ads selected')).toBeVisible()
  await expect.poll(() => page.locator('.creative-card-angle').count()).toBeGreaterThanOrEqual(3)
  return { businessId: businessId as string, ids }
}

const notes = (page: Page) => page.locator('.creative-card').filter({ hasText: 'From your avatar' })

test('ads written from a saved concept say so, and keep saying so after the concept is deleted', async ({
  page,
}) => {
  const { businessId, ids } = await reachCreativeCards(page, true)

  // At least one ad reused a saved concept; its line names that concept.
  await expect.poll(() => notes(page).count()).toBeGreaterThanOrEqual(1)
  const before = await notes(page).count()
  const savedLines = await notes(page).locator('.creative-card-angle').allTextContents()
  expect(
    savedLines.every((line) => AVATARS.some((a) => line.includes(a.concept[0]))),
  ).toBe(true)
  const results = await analyzeWhenReady(page, WCAG_TAGS)
  expect(results.violations).toEqual([])

  // Delete every saved concept, then reload: history does not change.
  for (const id of ids) {
    const response = await page.request.patch(
      `${E2E_API_URL}/businesses/${businessId}/avatars/${id}`,
      { data: { concepts: [] } },
    )
    expect(response.ok()).toBeTruthy()
  }
  await page.reload()
  await expect.poll(() => notes(page).count()).toBe(before)
})

test('with no saved concepts no ad carries the note', async ({ page }) => {
  await reachCreativeCards(page, false)

  await expect(page.getByText('From your avatar')).toHaveCount(0)
})
