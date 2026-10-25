import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { signUpAndReachFakeMetaConnectedBusiness } from './support/fakeMetaFlow'

// FAKE_LLM backend (see playwright.config.ts): generates the ad creatives without a model.

async function reachCreativeChoices(page: Page) {
  await signUpAndReachFakeMetaConnectedBusiness(page)
  await page.getByRole('button', { name: 'Generate strategy' }).click()
  await expect(page.getByText('Has this business run advertising campaigns before?')).toBeVisible()
  await page.getByRole('button', { name: 'No' }).click()
  await expect(page.getByRole('heading', { name: 'Creative angles to test' })).toBeVisible()
  await page.getByRole('button', { name: 'Generate ads' }).click()
  await expect(page.getByRole('heading', { name: 'Choose your ad creative' })).toBeVisible()
}

test('shows the creatives as cards with editing tucked away, and passes the axe checks', async ({
  page,
}) => {
  await reachCreativeChoices(page)
  const cards = page.getByRole('article')
  expect(await cards.count()).toBeGreaterThan(1)

  // New creatives carry no image/video prompts (they are no longer generated), so there is no
  // "Creative details" section to open; it only appears for older creatives that have them.
  await expect(page.getByRole('button', { name: 'Creative details' })).toHaveCount(0)

  // The editing controls are in their own collapsed section, one per card.
  const edit = cards.first().getByRole('button', { name: 'Edit creative' })
  await expect(edit).toHaveAttribute('aria-expanded', 'false')
  await expect(cards.nth(1).getByRole('button', { name: 'Edit creative' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(cards.first().getByRole('button', { name: 'Regenerate headline' })).toHaveCount(0)
  await edit.click()
  await expect(edit).toHaveAttribute('aria-expanded', 'true')
  await expect(cards.first().getByRole('button', { name: 'Regenerate headline' })).toBeVisible()

  // Automated WCAG 2.x A/AA rules (not a full audit).
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(axe.violations).toEqual([])
})

test('continuing with the second creative opens the preview for that creative', async ({
  page,
}) => {
  await reachCreativeChoices(page)
  const second = page.getByRole('article').nth(1)
  const headline = await second.getByRole('heading').first().innerText()

  await second.getByRole('button', { name: 'Continue with this creative' }).click()

  await expect(page.getByRole('heading', { name: 'Ad preview' })).toBeVisible()
  await expect(page.getByText(headline).first()).toBeVisible()
})

for (const width of [320, 375, 430]) {
  test(`has no horizontal scroll and 48px actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await reachCreativeChoices(page)
    await page.getByRole('button', { name: 'Edit creative' }).first().click()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const button = page.getByRole('button', { name: 'Continue with this creative' }).first()
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(48)
    const toggle = page.getByRole('button', { name: 'Edit creative' }).first()
    expect((await toggle.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  })
}
