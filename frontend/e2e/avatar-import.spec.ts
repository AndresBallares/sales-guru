import { test, expect } from '@playwright/test'
import { createBusinessWithBrand } from './support/fakeMetaFlow'

// Pasting research gives avatar drafts to review; only the ones kept are saved.
// FAKE_LLM (see playwright.config.ts) answers with two canned avatars, so no real
// Anthropic call happens here.
test('pasted research becomes drafts, and only the kept ones are saved', async ({ page }) => {
  await createBusinessWithBrand(page)
  const businessId = page.url().match(/businesses\/([^/?]+)/)?.[1]
  expect(businessId).toBeTruthy()
  const avatarsUrl = `http://localhost:8000/businesses/${businessId}/avatars`

  await page.getByText('Import buyer avatars from research').click()
  await page.getByLabel('Research document').fill('Gift buyers panic two days before an anniversary.')
  await page.getByRole('button', { name: 'Read document' }).click()

  await expect(page.getByRole('article', { name: 'Deadline Gift-Giver' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Self-Purchaser Collector' })).toBeVisible()
  expect(await (await page.request.get(avatarsUrl)).json()).toEqual([])

  await page.getByRole('article', { name: 'Deadline Gift-Giver' }).getByLabel('Name').fill('Last-minute giver')
  await page.getByRole('checkbox', { name: 'Keep Self-Purchaser Collector' }).uncheck()
  await page.getByRole('button', { name: 'Save 1 selected' }).click()

  await expect(page.getByText('Saved 1 avatar.')).toBeVisible()
  const saved = (await (await page.request.get(avatarsUrl)).json()) as { name: string; hooks: string[] }[]
  expect(saved.map((a) => a.name)).toEqual(['Last-minute giver'])
  expect(saved[0].hooks).toContain('Gold that outlasts the card.')
})
