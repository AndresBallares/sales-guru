import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Page, expect } from '@playwright/test'

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
// Signup through business+campaign creation, landing right on the product
// onboarding step ("No products yet") — split out from reachMetaPixelStep
// so product-photos.spec.ts can exercise ProductForm's own upload/staging
// UI directly, instead of going through the single-file default below.
export async function reachProductStep(page: Page): Promise<void> {
  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

  await page.getByLabel('Name').fill('Acme Widgets')
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByRole('button', { name: 'Create business' }).click()
  await expect(page.getByRole('heading', { name: 'Acme Widgets' })).toBeVisible()

  // Brand (PRD.md §5 step 3.5) comes first, ahead of the campaign
  // objective step — every flow through here needs to clear it once.
  await expect(page.getByRole('heading', { name: 'Brand' })).toBeVisible()
  await page.getByLabel(/Brand overview/).fill('Family-run studio since 1985.')
  await page.getByLabel('Ideal customer').fill('Busy professionals, 30-55.')
  await page.getByLabel('Warm').check()
  await page.getByLabel('Price positioning').selectOption({ label: 'Mid-range' })
  await page.getByRole('button', { name: 'Save brand profile' }).click()
  await expect(page.getByRole('heading', { name: 'Create a campaign' })).toBeVisible()

  // AWARENESS (Meta's REACH goal) needs no Pixel at *creation* time —
  // keeps this helper focused on the fake-Meta path, not every
  // objective's own extra setup step.
  await page.getByLabel('Objective').selectOption({ label: 'Awareness' })
  await page.getByRole('button', { name: 'Create campaign' }).click()

  await expect(page.getByText('No products yet')).toBeVisible()
}

// Returns the business id — callers past this point often need it for a
// direct API call (fake-connect itself already needed one), and re-
// deriving it from the URL a second time would just be duplicated work.
//
// withProductPhoto defaults to true since every normal path needs one to
// reach creative selection; product-photos.spec.ts passes false to reach
// the same point deliberately without one, to exercise the 428 block
// itself. productPhotoPaths overrides withProductPhoto entirely when
// given — one setInputFiles call per path, each appending a photo
// (ProductForm's own staging behavior, see product-photos.spec.ts) — for
// a spec that needs more than one (a carousel's cards map 1:1 to a
// product's photos).
export async function reachMetaPixelStep(
  page: Page,
  {
    withProductPhoto = true,
    productPhotoPaths,
    adAccountLabel = 'Fake Ad Account',
  }: {
    withProductPhoto?: boolean
    productPhotoPaths?: string[]
    adAccountLabel?: string
  } = {},
): Promise<string> {
  await reachProductStep(page)

  await page.getByLabel('What do you sell?').fill('Handmade leather wallets')
  // Optional for an AWARENESS campaign at *creation* time, but publish
  // (app/api/campaign.py's publish_campaign) always needs a destination
  // URL to advertise, whatever the objective — so this still needs one.
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

  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible()

  const businessId = page.url().match(/businesses\/([^/?]+)/)?.[1]
  if (!businessId) {
    throw new Error('could not read the business id out of the current URL')
  }
  // Playwright's request context shares this page's session cookie, so
  // this lands as the same logged-in user hitting the API directly —
  // exactly what a real "Connect Meta Ads" click would do, minus the
  // detour through Meta's own login/consent screens.
  const fakeConnectResponse = await page.request.post(
    `http://localhost:8000/businesses/${businessId}/meta/fake-connect`,
  )
  expect(fakeConnectResponse.ok()).toBe(true)
  await page.reload()

  await page.getByLabel('Ad account').selectOption({ label: adAccountLabel })
  await page.getByLabel('Page').selectOption({ label: 'Fake Page' })
  await page.getByRole('button', { name: 'Save connection' }).click()
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()

  return businessId
}

export async function signUpAndReachFakeMetaConnectedBusiness(
  page: Page,
  options: { withProductPhoto?: boolean } = {},
): Promise<void> {
  await reachMetaPixelStep(page, options)

  // Persisted on the connection itself (app/api/meta.py's skip_pixel),
  // not local-only state — see meta-pixel-skip.spec.ts for dedicated
  // coverage of that persistence.
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
}
