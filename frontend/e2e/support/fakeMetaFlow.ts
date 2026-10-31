import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Page, expect } from '@playwright/test'
import { E2E_API_URL } from './ports'

// select_creative now 428s a product with zero uploaded photos (confirmed
// 2026-09-09) — every flow here needs one on file before it can reach
// creative selection/publish, so this fixture gets uploaded right in the
// shared onboarding helper below, not per-spec. Exported so a spec
// needing more than one product photo (e.g. a carousel's cards, which
// map 1:1 to a product's photos) can build its own path list — reusing
// one of these twice is fine, since ProductImage rows are distinct per
// upload regardless of whether the underlying bytes repeat.
export const PRODUCT_PHOTO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'product-photo.jpg',
)
export const SECOND_PRODUCT_PHOTO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'product-photo-2.jpg',
)

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

// Shared by fake-meta-publish.spec.ts (fully faked, runs in CI),
// real-llm-publish.spec.ts (real Anthropic calls, opt-in local-only), and
// meta-pixel-skip.spec.ts — everything up through a fake Meta connection
// is identical either way; specs only differ in whether FAKE_LLM is also
// on for the backend they talk to (a webServer-level config choice, not
// something this helper can see or needs to), or in what they do once
// they reach the Pixel step.
//
// Real Meta OAuth needs a real user's real Meta login — nothing automated
// can drive it, which is why every e2e spec that isn't one of these stops
// right at the "Connect Meta Ads" button (see auth-and-business.spec.ts).
// fake-connect (gated behind FAKE_META, app/core/config.py's Settings,
// never on in production) gets past it instead.
//
// The onboarding order is: create the business, complete and confirm its Brand
// profile (on the dashboard), connect Meta, then create the first campaign.
// These helpers walk that order in pieces so a spec can stop wherever it needs.

// Signup, create the business, complete and save its Brand profile, and follow
// "Continue to Meta connection settings" to the business page's Meta step.
export async function createBusinessWithBrand(
  page: Page,
  businessName = 'Acme Widgets',
): Promise<void> {
  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

  await page.getByLabel('Name').fill(businessName)
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByRole('button', { name: 'Save Business' }).click()

  // Saving a business stays on the dashboard, in that business's Brand form.
  await expect(page.getByLabel(/Brand overview/)).toBeFocused()
  await page.getByLabel(/Brand overview/).fill('Family-run studio since 1985.')
  await page.getByLabel('Ideal customer').fill('Busy professionals, 30-55.')
  await page.getByLabel('Warm').check()
  await page.getByLabel('Price positioning').selectOption({ label: 'Mid-range' })
  await page.getByRole('button', { name: 'Save brand profile' }).click()

  await expect(page.getByText('Brand profile saved.')).toBeVisible()
  await page.getByRole('button', { name: 'Continue to Meta connection settings' }).click()

  // The Meta step comes before the first campaign.
  await expect(page.getByRole('heading', { name: businessName })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible()
}

// From the Meta step: fake-connect (real OAuth can't be automated), choose the
// ad account and Page, and save the connection, stopping at the Pixel step.
// Returns the business id — callers often need it for a direct API call.
export async function connectFakeMeta(
  page: Page,
  adAccountLabel = 'Fake Ad Account',
): Promise<string> {
  const businessId = page.url().match(/businesses\/([^/?]+)/)?.[1]
  if (!businessId) {
    throw new Error('could not read the business id out of the current URL')
  }
  // Playwright's request context shares this page's session cookie, so this lands
  // as the same logged-in user hitting the API directly — exactly what a real
  // "Connect Meta Ads" click would do, minus Meta's own login/consent screens.
  const fakeConnectResponse = await page.request.post(
    `${E2E_API_URL}/businesses/${businessId}/meta/fake-connect`,
  )
  expect(fakeConnectResponse.ok()).toBe(true)
  await page.reload()

  await page.getByLabel('Ad account').selectOption({ label: adAccountLabel })
  await page.getByLabel('Page').selectOption({ label: 'Fake Page' })
  await page.getByRole('button', { name: 'Save connection' }).click()
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()

  return businessId
}

// Business + Brand + fake Meta connection, stopping at the Pixel decision (the
// last part of the Meta step, before "Continue to campaigns").
export async function reachMetaPixelStep(
  page: Page,
  { adAccountLabel = 'Fake Ad Account' }: { adAccountLabel?: string } = {},
): Promise<string> {
  await createBusinessWithBrand(page)
  return connectFakeMeta(page, adAccountLabel)
}

// From a finished Meta step ("Continue to campaigns" showing): create the first
// campaign, a product and an audience, ending on the completed Campaigns view.
//
// withProductPhoto defaults to true since every normal path needs one to reach
// creative selection (select_creative 428s a product with no photos);
// product-photos.spec.ts reaches the product step without one on purpose.
// productPhotoPaths overrides it — one setInputFiles per path, each appending a
// photo — for a spec that needs several (a carousel's cards map 1:1 to photos).
export async function finishOnboarding(
  page: Page,
  {
    withProductPhoto = true,
    productPhotoPaths,
    objectiveLabel = 'Awareness',
  }: {
    withProductPhoto?: boolean
    productPhotoPaths?: string[]
    objectiveLabel?: string
  } = {},
): Promise<void> {
  await createFirstCampaign(page, objectiveLabel)

  await page.getByLabel('What do you sell?').fill('Handmade leather wallets')
  // Optional for an AWARENESS campaign at *creation* time, but publish always
  // needs a destination URL to advertise, whatever the objective.
  await page.getByLabel(/^URL/).fill('https://acme.example/wallets')
  if (productPhotoPaths) {
    for (const photoPath of productPhotoPaths) {
      await page.getByLabel(/Product photos/).setInputFiles(photoPath)
    }
    await expect(page.getByRole('img')).toHaveCount(productPhotoPaths.length)
  } else if (withProductPhoto) {
    await page.getByLabel(/Product photos/).setInputFiles(PRODUCT_PHOTO_PATH)
    await expect(page.getByRole('img')).toBeVisible()
  }
  await page.getByRole('button', { name: 'Add product' }).click()

  await expect(page.getByText('No audiences yet')).toBeVisible()
  await page.getByLabel('Who buys?').fill('Busy professionals, 30-55')
  await page.getByRole('button', { name: 'Add audience' }).click()

  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
  // Adding the audience completes the campaign's setup: the server moves it from Draft to
  // Ready and the card is redrawn without its setup progress bar, which moves its button.
  // Carry on once that has happened.
  await expect(page.locator('.campaign-tile-progress')).toHaveCount(0)
  // The campaigns page is a card per campaign; carry on in the one just created.
  await openFirstCampaign(page)
}

// From the campaigns overview, open the first campaign's detail view through its card's
// primary action (its label depends on the campaign's status), where strategy, ad choices
// and publishing live.
export async function openFirstCampaign(page: Page): Promise<void> {
  const tile = page.locator('.campaign-tile-primary').first()
  const back = page.getByRole('button', { name: /back to campaigns/i })
  // A card is redrawn when its campaign changes under it, and its button moves with it. A
  // click split across that move is dropped by the browser with no error and no navigation
  // (about 1 run in 100). So click and check as one unit, and try the pair again; if the
  // detail view is already open, do not click a card that is no longer there.
  await expect(async () => {
    if (!(await back.isVisible())) await tile.click({ timeout: 2_000 })
    await expect(back).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

// "Continue to campaigns", then create the first campaign (AWARENESS needs no
// Pixel at *creation* time, which keeps these helpers focused on the Meta path).
async function createFirstCampaign(page: Page, objectiveLabel: string): Promise<void> {
  await page.getByRole('button', { name: 'Continue to campaigns' }).click()
  await expect(page.getByRole('heading', { name: 'Create a campaign' })).toBeVisible()
  await page.getByLabel('Objective').selectOption({ label: objectiveLabel })
  await page.getByRole('button', { name: 'Create campaign' }).click()
  await expect(page.getByText('No products yet')).toBeVisible()
}

// The whole way through to the product step ("No products yet"), skipping the
// optional Pixel — split out so product-photos.spec.ts can exercise
// ProductForm's own upload/staging UI directly.
export async function reachProductStep(
  page: Page,
  objectiveLabel = 'Awareness',
): Promise<void> {
  await reachMetaPixelStep(page)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await createFirstCampaign(page, objectiveLabel)
}

export async function signUpAndReachFakeMetaConnectedBusiness(
  page: Page,
  options: { withProductPhoto?: boolean } = {},
): Promise<void> {
  await reachMetaPixelStep(page)

  // Persisted on the connection itself (app/api/meta.py's skip_pixel), not
  // local-only state — see meta-pixel-skip.spec.ts for dedicated coverage.
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await finishOnboarding(page, options)
}
