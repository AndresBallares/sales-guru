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

// The whole card goes: its text, photo, three-dot menu button, and the list item itself.
async function expectCardGone(page: Page, label: string) {
  await expect(page.getByRole('button', { name: `More actions for ${label}` })).toHaveCount(0)
  await expect(page.getByRole('img', { name: label })).toHaveCount(0)
  await expect(page.getByRole('listitem', { name: label })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: label, level: 3 })).toHaveCount(0)
}

// Opens a card's three-dot menu and picks an action.
async function chooseFromMenu(page: Page, label: string, action: 'Edit Product' | 'Delete Product') {
  await page.getByRole('button', { name: `More actions for ${label}` }).click()
  await page.getByRole('menuitem', { name: action }).click()
}

async function addProductInDrawer(page: Page, description: string, name: string) {
  await page.getByRole('button', { name: 'Add Product' }).click()
  const drawer = page.getByRole('dialog', { name: 'Add New Product' })
  await drawer.getByLabel('What do you sell?').fill(description)
  await drawer.getByLabel(/Product name/).fill(name)
  await drawer.getByRole('button', { name: 'Save Product' }).click()
  await expect(drawer).toHaveCount(0)
  await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible()
}

function businessIdOf(page: Page): string {
  const id = page.url().match(/businesses\/([^/?#]+)/)?.[1]
  expect(id).toBeTruthy()
  return id as string
}

test('add a product in the drawer, watch the mechanism counter, edit it, and keep the tab on reload', async ({
  page,
}) => {
  await createBusinessWithBrand(page)
  await page.getByRole('tab', { name: 'Products' }).click()
  await expect(page).toHaveURL(/#products$/)
  await expect(page.getByRole('heading', { name: 'Products', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible()
  // No add form sits on the page: it opens from the header button.
  await expect(page.getByLabel('What do you sell?')).toHaveCount(0)
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: 'Add Product' }).click()
  const drawer = page.getByRole('dialog', { name: 'Add New Product' })
  await expect(drawer.getByLabel('What do you sell?')).toBeFocused()
  await drawer.getByLabel('What do you sell?').fill('Gold hoops')
  await drawer.getByLabel(/Product name/).fill('Hoops')
  const mechanism = drawer.getByLabel(/Mechanism/)

  // A pasted mechanism over the limit is kept, not cut: the counter and an error say so.
  await mechanism.fill('x'.repeat(650))
  await expect(drawer.getByText('650 / 600')).toBeVisible()
  await expect(drawer.getByRole('alert')).toContainText('50 characters too many')
  await expect(mechanism).toHaveValue('x'.repeat(650))
  await expectNoAxeViolations(page)

  await drawer.getByRole('button', { name: 'Save Product' }).click()
  await expect(page.getByRole('heading', { name: 'Hoops', level: 3 })).toHaveCount(0)

  await mechanism.fill('Hand-polished solid gold')
  await expect(drawer.getByText('24 / 600')).toBeVisible()
  await expect(drawer.getByRole('alert')).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Save Product' }).click()

  // The drawer closes, the card is in the grid, and focus is back on the button that opened it.
  await expect(drawer).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Hoops', level: 3 })).toBeVisible()
  await expect(page.getByText('1 product', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Product' })).toBeFocused()

  await chooseFromMenu(page, 'Hoops', 'Edit Product')
  const editor = page.getByRole('dialog', { name: 'Edit Product' })
  await expect(editor.getByLabel(/Mechanism/)).toHaveValue('Hand-polished solid gold')
  await expect(editor.getByText(/apply the next time ads are generated/)).toBeVisible()
  await expectNoAxeViolations(page)
  await editor.getByLabel(/Product name/).fill('Hoops Large')
  await editor.getByRole('button', { name: 'Save Changes' }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Hoops Large', level: 3 })).toBeVisible()
  await expect(page.getByText(/out of date/)).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Products' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('heading', { name: 'Hoops Large', level: 3 })).toBeVisible()
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
  await page.getByRole('button', { name: /^More actions for Handmade leather wallets/ }).click()
  await page.getByRole('menuitem', { name: 'Edit Product' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit Product' })
  await editor.getByLabel('What do you sell?').fill('Handmade leather wallets, now in navy')
  await editor.getByRole('button', { name: 'Save Changes' }).click()

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
  await editor.getByRole('button', { name: 'Save Changes' }).click()
  await editor.getByRole('button', { name: 'Save anyway' }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.locator('.product-card-description')).toContainText(
    'Handmade leather wallets, now in navy',
  )
  expect((await staleFlags()).every((stale) => stale)).toBe(true)
})

test('delete: a product no campaign uses goes after a question; one a campaign uses is refused', async ({
  page,
}) => {
  // Onboarding leaves one campaign using one product (the wallets).
  await reachMetaPixelStep(page)
  await page.getByLabel('Meta Pixel').selectOption({ label: 'Fake Pixel' })
  await page.getByRole('button', { name: 'Save Pixel' }).click()
  await finishOnboarding(page, { objectiveLabel: 'Sales' })

  await page.getByRole('tab', { name: 'Products' }).click()
  await addProductInDrawer(page, 'Gold hoops', 'Hoops')

  // Asking first: Keep it changes nothing and focus returns to the card's menu button.
  await chooseFromMenu(page, 'Hoops', 'Delete Product')
  const confirm = page.getByRole('group', { name: 'Confirm deleting Hoops' })
  await expect(confirm).toContainText('Delete Hoops and all its photos and videos?')
  await expectNoAxeViolations(page)
  await confirm.getByRole('button', { name: 'Keep it' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'More actions for Hoops' })).toBeFocused()

  // Yes, delete: the whole card is gone and focus moves to the list heading.
  await chooseFromMenu(page, 'Hoops', 'Delete Product')
  await confirm.getByRole('button', { name: 'Yes, delete' }).click()
  await expectCardGone(page, 'Hoops')
  await expect(page.getByRole('heading', { name: 'Products', level: 2 })).toBeFocused()

  // The wallets are used by the campaign: refused, with the campaign named, nothing removed.
  await page.getByRole('button', { name: /^More actions for Handmade leather wallets/ }).click()
  await page.getByRole('menuitem', { name: 'Delete Product' }).click()
  await page.getByRole('button', { name: 'Yes, delete' }).click()
  const refusal = page.getByRole('alert').filter({ hasText: 'used by 1 campaign' })
  await expect(refusal).toBeVisible()
  await expect(refusal).toBeFocused()
  await expectNoAxeViolations(page)
  await expect(
    page.getByRole('button', { name: /^More actions for Handmade leather wallets/ }),
  ).toBeVisible()
})

test('delete: the card disappears even when the list reload after it fails', async ({ page }) => {
  await createBusinessWithBrand(page)
  await page.getByRole('tab', { name: 'Products' }).click()
  await addProductInDrawer(page, 'Gold hoops', 'Hoops')

  // From here on the product list cannot be fetched; only the delete itself goes through.
  await page.route('**/businesses/*/products', (route) =>
    route.request().method() === 'GET' ? route.abort() : route.continue(),
  )
  await chooseFromMenu(page, 'Hoops', 'Delete Product')
  await page.getByRole('button', { name: 'Yes, delete' }).click()

  await expectCardGone(page, 'Hoops')
  await expect(page.getByRole('heading', { name: 'Products', level: 2 })).toBeFocused()
  await page.unroute('**/businesses/*/products')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible()
})

test('closing the drawer with unsaved changes asks first; Escape closes an untouched one', async ({
  page,
}) => {
  await createBusinessWithBrand(page)
  await page.getByRole('tab', { name: 'Products' }).click()
  const opener = page.getByRole('button', { name: 'Add Product' })

  // Nothing typed: Escape closes at once and focus returns to the opener.
  await opener.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()

  // Something typed: the question appears, Keep editing keeps the text, Discard throws it away.
  await opener.click()
  const drawer = page.getByRole('dialog', { name: 'Add New Product' })
  await drawer.getByLabel('What do you sell?').fill('Gold hoops')
  await page.keyboard.press('Escape')
  const ask = page.getByRole('alertdialog', { name: 'Discard your changes?' })
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused()
  await expectNoAxeViolations(page)
  await ask.getByRole('button', { name: 'Keep editing' }).click()
  await expect(drawer.getByLabel('What do you sell?')).toHaveValue('Gold hoops')
  await drawer.getByRole('button', { name: 'Cancel' }).click()
  await ask.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('the grid is three columns on a wide screen and one on a phone, and the drawer fits both', async ({
  page,
}) => {
  await createBusinessWithBrand(page)
  await page.getByRole('tab', { name: 'Products' }).click()
  for (const [description, name] of [
    ['Gold hoops', 'Hoops'],
    ['Silver studs', 'Studs'],
    ['Pearl pendant', 'Pendant'],
    // A long description and a long URL must not stretch their card.
    ['A long description. '.repeat(45), 'Long one'],
  ]) {
    await addProductInDrawer(page, description, name)
  }

  const tops = async () =>
    page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3 }) }).evaluateAll(
      (cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)),
    )
  const heights = async () =>
    page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3 }) }).evaluateAll(
      (cards) => cards.map((card) => Math.round(card.getBoundingClientRect().height)),
    )

  await page.setViewportSize({ width: 1280, height: 900 })
  expect(new Set((await tops()).slice(0, 3)).size).toBe(1)
  expect(new Set(await heights()).size).toBe(1)
  await expectNoAxeViolations(page)

  await page.setViewportSize({ width: 390, height: 800 })
  expect(new Set(await tops()).size).toBe(4)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  // On a phone the drawer takes the whole width and its Save row stays reachable.
  await page.getByRole('button', { name: 'Add Product' }).click()
  const drawer = page.getByRole('dialog', { name: 'Add New Product' })
  const box = await drawer.boundingBox()
  expect(box?.width).toBe(390)
  await expect(drawer.getByRole('button', { name: 'Save Product' })).toBeInViewport()
  await expectNoAxeViolations(page)
})

test('search narrows the grid by name and says so when nothing matches', async ({ page }) => {
  await createBusinessWithBrand(page)
  await page.getByRole('tab', { name: 'Products' }).click()
  await addProductInDrawer(page, 'Gold hoops', 'Hoops')
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await addProductInDrawer(page, 'Silver studs', 'Studs')

  await page.getByRole('searchbox', { name: 'Search products' }).fill('stud')
  await expect(page.getByRole('heading', { name: 'Studs', level: 3 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hoops', level: 3 })).toHaveCount(0)

  await page.getByRole('searchbox', { name: 'Search products' }).fill('zzz')
  await expect(page.getByText('No products found. Try another search.')).toBeVisible()
})
