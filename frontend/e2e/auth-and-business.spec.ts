import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

test('an unauthenticated visitor is redirected to /login', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})

test('login page has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/login')
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

// Regression coverage for a real incident: a user signed up, and the
// password they'd just set didn't work on a later login — never fully
// root-caused (the backend's own hash/verify round-trip checked out fine
// in isolation), so this exercises the whole real path start to finish —
// actual browser form fields, actual submit, actual backend — isolated
// from the much longer combined flow below so a regression here fails
// fast and unambiguously, not buried under business/product/audience/
// campaign assertions.
test('signs up, logs out, and logs back in with the same password', async ({ page }) => {
  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
})

test('sign up, create a business, log out, log back in', async ({ page }) => {
  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await expect(page.getByText('No businesses yet')).toBeVisible()

  await page.getByLabel('Name').fill('Acme Widgets')
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByLabel('Location').fill('CDMX')
  await page.getByRole('button', { name: 'Save Business' }).click()

  // The onboarding order: business -> Brand profile -> save and confirm ->
  // Meta connection -> first campaign. Saving a business stays on the dashboard,
  // in that business's Brand form, ready to complete.
  await expect(page.getByLabel(/Brand overview/)).toBeFocused()
  await expect(page.getByLabel('Business', { exact: true })).toHaveCount(0)

  const brandFormResults = await new AxeBuilder({ page }).analyze()
  expect(brandFormResults.violations).toEqual([])

  await page.getByLabel(/Brand overview/).fill('Family-run studio since 1985.')
  await page.getByLabel('Ideal customer').fill('Women 30-55 buying for milestones.')
  await page.getByLabel('Warm').check()
  await page.getByLabel('Price positioning').selectOption({ label: 'Premium' })
  await page.getByRole('button', { name: 'Save brand profile' }).click()

  // Saved and confirmed, with a clear way on to the Meta connection settings.
  await expect(page.getByText('Brand profile saved.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save brand profile' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit brand profile' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue to Meta connection settings' }).click()

  // The Meta step comes before any campaign; real OAuth can't be driven here,
  // so it is only checked (the fake-meta specs go through it).
  await expect(page.getByRole('heading', { name: 'Acme Widgets' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect Meta Ads' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create a campaign' })).not.toBeVisible()

  const metaStepResults = await new AxeBuilder({ page }).analyze()
  expect(metaStepResults.violations).toEqual([])

  // Fake-connect stands in for the OAuth round trip.
  const businessId = page.url().match(/businesses\/([^/?]+)/)?.[1]
  const fakeConnect = await page.request.post(
    `http://localhost:8000/businesses/${businessId}/meta/fake-connect`,
  )
  expect(fakeConnect.ok()).toBe(true)
  await page.reload()
  await page.getByLabel('Ad account').selectOption({ label: 'Fake Ad Account' })
  await page.getByLabel('Page').selectOption({ label: 'Fake Page' })
  await page.getByRole('button', { name: 'Save connection' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Meta saved: a clear Continue to campaigns.
  await expect(page.getByText('Meta connection saved.')).toBeVisible()
  await page.getByRole('button', { name: 'Continue to campaigns' }).click()

  await expect(page.getByText('No campaigns yet')).toBeVisible()

  const businessDetailResults = await new AxeBuilder({ page }).analyze()
  expect(businessDetailResults.violations).toEqual([])

  await page.getByLabel('Objective').selectOption({ label: 'Sales' })
  await page.getByRole('button', { name: 'Create campaign' }).click()

  // Creating the campaign moves straight to the product step — the
  // campaign step (and the campaign itself) is no longer shown on screen.
  await expect(page.getByText('No products yet')).toBeVisible()
  await page.getByLabel('What do you sell?').fill('Handmade leather wallets')
  await page.getByLabel('Price').fill('49.99')
  await page.getByLabel(/^URL/).fill('https://acme.example/wallets')
  await page.getByRole('button', { name: 'Add product' }).click()

  // Adding a product — the campaign's only product — auto-attaches it
  // (app/services/campaign_readiness.py) and moves straight to the
  // audience step; the product step (and the product itself) is no
  // longer shown on screen.
  await expect(page.getByText('No audiences yet')).toBeVisible()
  await page.getByLabel('Who buys?').fill('Busy professionals, 30-55')
  await page.getByLabel('Age min').fill('30')
  await page.getByLabel('Age max').fill('55')
  await page.getByLabel('Where are your customers?').fill('New York')
  await page.getByRole('button', { name: 'Add audience' }).click()

  // Adding an audience completes the onboarding: Meta is already connected, so
  // the full Campaigns view opens with no Meta step in front of it.
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).not.toBeVisible()

  await page.getByRole('button', { name: 'Back to dashboard' }).click()
  await expect(page.getByRole('heading', { name: 'Sales Guru' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Acme Widgets' })).toBeVisible()
  await expect(page.getByText('Fashion / Jewelry · CDMX')).toBeVisible()

  const dashboardResults = await new AxeBuilder({ page }).analyze()
  expect(dashboardResults.violations).toEqual([])

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Acme Widgets' })).toBeVisible()
  await expect(page.getByText('Fashion / Jewelry · CDMX')).toBeVisible()
})

// Dedicated coverage for the Brand ("brand DNA") profile (PRD.md §5 step 3.5),
// which lives on the dashboard under Company Information: isolates the
// required-field gate and the "editable later" round-trip.
test('the Brand section blocks on required fields, then is editable later', async ({
  page,
}) => {
  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByLabel('Name').fill('Venzi Jewelry')
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByRole('button', { name: 'Save Business' }).click()

  // Saving the business leaves you in its Brand form on the dashboard.
  await expect(page.getByRole('heading', { name: 'Brand DNA' })).toBeVisible()
  await expect(page.getByLabel(/Brand overview/)).toBeFocused()

  // The browser's own required-field validation blocks submission with
  // the ideal-customer field (and every other required field) still
  // empty — the form stays put, not a silent no-op or a server round-trip.
  await page.getByLabel(/Brand overview/).fill('Family-run studio since 1985.')
  await page.getByRole('button', { name: 'Save brand profile' }).click()
  await expect(page.getByRole('button', { name: 'Save brand profile' })).toBeVisible()

  await page.getByLabel('Ideal customer').fill('Women 30-55 buying for milestones.')
  await page.getByLabel('Artisanal').check()
  await page.getByLabel('Price positioning').selectOption({ label: 'Luxury' })
  await page.getByRole('button', { name: 'Save brand profile' }).click()

  // Saved — the form gives way to a summary with "Edit brand profile".
  await expect(page.getByRole('button', { name: 'Save brand profile' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit brand profile' })).toBeVisible()

  await page.getByRole('button', { name: 'Edit brand profile' }).click()
  await expect(page.getByLabel(/Brand overview/)).toHaveValue(
    'Family-run studio since 1985.',
  )

  await page.getByLabel('Tagline').fill('Wear your story')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page.getByRole('button', { name: 'Edit brand profile' })).toBeVisible()
})

test('signup rejects a duplicate email', async ({ page }) => {
  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()

  await expect(page.getByRole('alert')).toHaveText('Email already registered')
})

test('a business without a brand profile cannot start a campaign until it has one', async ({
  page,
}) => {
  const email = uniqueEmail()
  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('supersecret123')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByLabel('Name').fill('Gated Co')
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByRole('button', { name: 'Save Business' }).click()
  await expect(page.getByLabel(/Brand overview/)).toBeFocused()

  // Skip the Brand form and open the business page directly.
  await page.getByRole('link', { name: 'Gated Co' }).click()

  await expect(
    page.getByRole('heading', { name: 'Complete the Brand DNA first' }),
  ).toBeVisible()
  await expect(page.getByText(/Campaigns can't be created until it does/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create a campaign' })).not.toBeVisible()

  const gateResults = await new AxeBuilder({ page }).analyze()
  expect(gateResults.violations).toEqual([])

  // The link goes back to that business's Brand form, ready to complete.
  await page.getByRole('link', { name: 'Complete the Brand DNA' }).click()
  await expect(page.getByLabel(/Brand overview/)).toBeFocused()
  await expect(page).toHaveURL(/\/$/)
})

test('after saving the Brand profile you can skip Meta for now and go on to the campaigns', async ({
  page,
}) => {
  const email = uniqueEmail()
  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('supersecret123')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByLabel('Name').fill('Skipper Co')
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByRole('button', { name: 'Save Business' }).click()

  await page.getByLabel(/Brand overview/).fill('Family-run studio since 1985.')
  await page.getByLabel('Ideal customer').fill('Busy professionals, 30-55.')
  await page.getByLabel('Warm').check()
  await page.getByLabel('Price positioning').selectOption({ label: 'Mid-range' })
  await page.getByRole('button', { name: 'Save brand profile' }).click()

  // Both choices appear once the profile is saved, Continue first.
  await expect(page.getByText('Brand profile saved.')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Continue to Meta connection settings' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Skip for now' }).click()

  // Straight to the business's campaign step, without the Meta step.
  await expect(page.getByRole('heading', { name: 'Skipper Co' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create a campaign' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).not.toBeVisible()
})
