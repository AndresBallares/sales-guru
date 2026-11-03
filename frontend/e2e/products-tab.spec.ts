import { test, expect, type Page } from '@playwright/test'
import { createBusinessWithBrand, finishOnboarding, reachMetaPixelStep } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'
import { E2E_API_URL } from './support/ports'

// The Products tab on the business page: list, add, edit, the mechanism counter, and the
// warning before an edit that would mark ads out of date. No model or Meta call is paid for:
// the whole suite runs on FAKE_LLM and FAKE_META (see playwright.config.ts).

// Axe samples colours at one instant; settle every transition before scanning.
async function settleTransitions(page: Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
}

async function expectNoAxeViolations(page: Page) {
  await settleTransitions(page)
  const results = await analyzeWhenReady(page, WCAG_TAGS)
  expect(results.violations).toEqual([])
}

function businessIdOf(page: Page): string {
  const id = page.url().match(/businesses\/([^/?#]+)/)?.[1]
  expect(id).toBeTruthy()
  return id as string
}

test('add a product, watch the mechanism counter, edit it, and keep the tab on reload', async ({
  page,
}) => {
  await createBusinessWithBrand(page)
  await page.getByRole('tab', { name: 'Products' }).click()
  await expect(page).toHaveURL(/#products$/)
  await expect(page.getByRole('heading', { name: 'Products', level: 2 })).toBeVisible()
  await expect(page.getByText(/No products yet/)).toBeVisible()
  await expectNoAxeViolations(page)

  await page.getByLabel('What do you sell?').fill('Gold hoops')
  await page.getByLabel(/Product name/).fill('Hoops')
  const mechanism = page.getByLabel(/Mechanism/)

  // A pasted mechanism over the limit is kept, not cut: the counter and an error say so.
  await mechanism.fill('x'.repeat(650))
  await expect(page.getByText('650 / 600')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('50 characters too many')
  await expect(mechanism).toHaveValue('x'.repeat(650))
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: 'Add product' }).click()
  await expect(page.getByRole('button', { name: 'Edit Hoops' })).toHaveCount(0)

  await mechanism.fill('Hand-polished solid gold')
  await expect(page.getByText('24 / 600')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add product' }).click()

  // The product is listed, and the add form starts over.
  await expect(page.getByRole('button', { name: 'Edit Hoops' })).toBeVisible()
  await expect(page.getByLabel('What do you sell?')).toHaveValue('')
  await expect(mechanism).toHaveValue('')

  await page.getByRole('button', { name: 'Edit Hoops' }).click()
  const editor = page.getByRole('listitem', { name: 'Editing Hoops' })
  await expect(editor.getByLabel(/Mechanism/)).toHaveValue('Hand-polished solid gold')
  await expect(editor.getByText(/apply the next time ads are generated/)).toBeVisible()
  await expectNoAxeViolations(page)
  await editor.getByLabel(/Product name/).fill('Hoops Large')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Edit Hoops Large' })).toBeVisible()
  await expect(page.getByText(/out of date/)).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Products' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Edit Hoops Large' })).toBeVisible()
})

test('an edit that would make ads out of date asks first, and Go back changes nothing', async ({
  page,
}) => {
  // A Sales creative test with generated ads (the same faked flow as edit-creative.spec.ts).
  await reachMetaPixelStep(page)
  await page.getByLabel('Meta Pixel').selectOption({ label: 'Fake Pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await finishOnboarding(page, { objectiveLabel: 'Sales' })
  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(page.getByText('Has this business run advertising campaigns before?')).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByText(/Creative test/)).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  await expect(page.getByText('0 of 3–4 ads selected')).toBeVisible()

  const businessId = businessIdOf(page)
  const staleFlags = async () => {
    const campaigns = (await (
      await page.request.get(`${E2E_API_URL}/businesses/${businessId}/campaigns`)
    ).json()) as { id: string }[]
    const creatives = (await (
      await page.request.get(
        `${E2E_API_URL}/businesses/${businessId}/campaigns/${campaigns[0].id}/creatives`,
      )
    ).json()) as { isStale: boolean }[]
    return creatives.map((c) => c.isStale)
  }
  expect((await staleFlags()).every((stale) => !stale)).toBe(true)

  await page.getByRole('tab', { name: 'Products' }).click()
  await page.getByRole('button', { name: /^Edit Handmade leather wallets/ }).click()
  const editor = page.getByRole('listitem', { name: /^Editing / })
  await editor.getByLabel('What do you sell?').fill('Handmade leather wallets, now in navy')
  await editor.getByRole('button', { name: 'Save' }).click()

  // Nothing is saved yet: the owner is told which ads would go out of date.
  const panel = editor.getByRole('alert').filter({ hasText: 'out of date' })
  await expect(panel).toContainText('This change will mark ads as out of date')
  await expect(panel).toContainText(/\d+ ads? will be marked out of date/)
  await expect(panel).toContainText('Regenerate')
  await expect(panel).toBeFocused()
  await expectNoAxeViolations(page)
  expect((await staleFlags()).every((stale) => !stale)).toBe(true)

  // Go back: still not saved, and the owner's text is still in the form.
  await panel.getByRole('button', { name: 'Go back' }).click()
  await expect(panel).toHaveCount(0)
  await expect(editor.getByLabel('What do you sell?')).toHaveValue(
    'Handmade leather wallets, now in navy',
  )
  expect((await staleFlags()).every((stale) => !stale)).toBe(true)

  // Save anyway: the edit is saved and the ads now read as out of date.
  await editor.getByRole('button', { name: 'Save' }).click()
  await editor.getByRole('button', { name: 'Save anyway' }).click()
  await expect(page.getByText('Handmade leather wallets, now in navy')).toBeVisible()
  expect((await staleFlags()).every((stale) => stale)).toBe(true)
})
