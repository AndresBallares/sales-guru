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
  await expect(page.locator('.campaign-tile')).toHaveCount(1)
  await page.getByRole('button', { name: 'Create campaign' }).click()
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/campaigns$/.test(r.url()),
  )
  await page.getByRole('button', { name: 'Next' }).click()
  await created
  await page.reload()
  await expect(page.locator('.campaign-tile')).toHaveCount(2)
}

// The second campaign, left as a draft that still needs a product and an audience.
function draftCard(page: Page) {
  return page.locator('.campaign-tile[data-status="DRAFT"]')
}

test('a draft card shows its setup progress and continues the missing step', async ({ page }) => {
  await reachDraftCampaign(page)

  // The overview card: a real progress bar and what is next, with Continue setup.
  const card = draftCard(page)
  await expect(card.getByText('Draft')).toBeVisible()
  await expect(card.getByRole('progressbar', { name: '1 of 3 setup steps done' })).toBeVisible()
  await expect(card.getByText('Next: Choose a product')).toBeVisible()
  await expect(card.getByText('No creatives yet')).toBeVisible()
  await expectNoAxeViolations(page)

  // Continue setup opens the campaign, where the readiness checklist lives.
  await card.getByRole('button', { name: 'Continue setup' }).click()
  await expect(page).toHaveURL(/campaign=/)
  const setup = page.getByRole('region', { name: /Campaign readiness for/ })
  await expect(setup).toContainText('1 of 3 setup steps complete')
  await expect(setup).toContainText('33%')
  await expect(setup.getByRole('button')).toHaveCount(0)

  await page.getByRole('button', { name: 'Continue setup' }).click()
  await expect(page.getByLabel('What do you sell?')).toBeVisible()
  await expectNoAxeViolations(page)

  // Back to campaigns returns to the cards.
  await page.getByRole('button', { name: /back to campaigns/i }).click()
  await expect(page.locator('.campaign-tile')).toHaveCount(2)
})

async function expectNoAxeViolations(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(axe.violations).toEqual([])
}

for (const width of [320, 375]) {
  test(`the campaign cards fit a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await reachDraftCampaign(page)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await draftCard(page).getByRole('button', { name: 'Continue setup' }).boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await expectNoAxeViolations(page)
  })
}

test('the delete confirmation has room around its text and aligned, underlined Cancel', async ({
  page,
}) => {
  await reachDraftCampaign(page)
  // Delete lives in the card's more-actions menu and confirms in the card.
  await draftCard(page).getByRole('button', { name: /More actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()

  const dialog = draftCard(page).getByRole('alertdialog')
  const confirm = dialog.getByRole('button', { name: 'Delete campaign' })
  const cancel = dialog.getByRole('button', { name: 'Cancel' })
  const [panel, text, confirmBox, cancelBox] = await Promise.all([
    dialog.boundingBox(),
    dialog.locator('p').boundingBox(),
    confirm.boundingBox(),
    cancel.boundingBox(),
  ])

  // Space between the sentence and the buttons, and padding inside the panel.
  expect(confirmBox!.y - (text!.y + text!.height)).toBeGreaterThanOrEqual(12)
  expect(text!.x - panel!.x).toBeGreaterThanOrEqual(16)
  // Cancel sits on the button's centre line, as underlined text.
  expect(Math.abs(confirmBox!.y + confirmBox!.height / 2 - (cancelBox!.y + cancelBox!.height / 2))).toBeLessThanOrEqual(1)
  expect(await cancel.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline')
})
