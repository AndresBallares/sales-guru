import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { createBusinessWithBrand } from './support/fakeMetaFlow'

// A business with one finished campaign, plus a second one left as a draft (the guided flow
// creates it on "Next"), so the page shows a draft card that still needs a product and audience.
async function reachDraftCampaign(page: Page) {
  await createBusinessWithBrand(page)
  await page.getByRole('link', { name: 'Skip for now' }).click()
  await page.getByLabel('Objective').selectOption({ label: 'Awareness' })
  await page.getByRole('button', { name: 'Create campaign' }).click()
  await expect(page.getByText('No products yet')).toBeVisible()
  await page.getByLabel('What do you sell?').fill('Handmade leather wallets')
  await page.getByLabel(/^URL/).fill('https://acme.example/wallets')
  await page.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByText('No audiences yet')).toBeVisible()
  await page.getByLabel('Who buys?').fill('Busy professionals, 30-55')
  await page.getByRole('button', { name: 'Add audience' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('button', { name: 'Delete campaign' })).toBeVisible()
  await page.getByRole('button', { name: 'Create campaign' }).click()
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/campaigns$/.test(r.url()),
  )
  await page.getByRole('button', { name: 'Next' }).click()
  await created
  await page.reload()
  await expect(page.getByRole('button', { name: 'Delete campaign' })).toHaveCount(2)
}

test('a draft card shows its setup progress and continues the missing step', async ({ page }) => {
  await reachDraftCampaign(page)

  const setup = page.getByRole('region', { name: /Campaign readiness for/ })
  await expect(setup).toContainText('1 of 3 setup steps complete')
  await expect(setup).toContainText('33%')
  await expect(setup.getByRole('button', { name: 'Attach product' })).toBeVisible()

  await page.getByRole('button', { name: 'Continue setup' }).click()
  await expect(page.getByLabel('What do you sell?')).toBeVisible()

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(axe.violations).toEqual([])
})

for (const width of [320, 375]) {
  test(`the campaign cards fit a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await reachDraftCampaign(page)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await page.getByRole('button', { name: 'Continue setup' }).boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
  })
}
