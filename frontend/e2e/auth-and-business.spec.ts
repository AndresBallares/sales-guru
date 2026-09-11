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
  await page.getByRole('button', { name: 'Sign up' }).click()

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await expect(page.getByText('No businesses yet')).toBeVisible()

  await page.getByLabel('Name').fill('Acme Widgets')
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByLabel('Location').fill('CDMX')
  await page.getByRole('button', { name: 'Create business' }).click()

  // Creating a business navigates straight to its own detail page — no
  // dead-end empty form left behind on the dashboard. Brand comes first
  // in this flow (PRD.md §5 step 3.5, confirmed 2026-09-11) — a short
  // one-time questionnaire the Strategist/Creative Agents ground into
  // once filled in — ahead of even the campaign objective step.
  await expect(page.getByRole('heading', { name: 'Acme Widgets' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Brand' })).toBeVisible()

  const brandStepResults = await new AxeBuilder({ page }).analyze()
  expect(brandStepResults.violations).toEqual([])

  await page.getByLabel(/Brand overview/).fill('Family-run studio since 1985.')
  await page.getByLabel('Ideal customer').fill('Women 30-55 buying for milestones.')
  await page.getByLabel('Warm').check()
  await page.getByLabel('Price positioning').selectOption({ label: 'Premium' })
  await page.getByRole('button', { name: 'Save brand profile' }).click()

  // Saving the brand profile moves straight to the campaign objective
  // step — its onboarding form is gone, replaced by a summary + "Edit
  // brand profile" that stays reachable from here on (not a one-time-
  // only gate — see the dedicated brand-profile-onboarding spec).
  await expect(page.getByText('No campaigns yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save brand profile' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit brand profile' })).toBeVisible()

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

  // Adding an audience moves straight to the Meta Ads step — the
  // audience step (and the audience itself) is no longer shown on screen.
  // The Campaigns step is now gated behind a completed Meta connection
  // (real OAuth, which this suite can't drive), so Campaigns must NOT
  // appear alongside it — this is exactly the bug this gating fixed.
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect Meta Ads' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Campaigns' })).not.toBeVisible()

  const metaStepResults = await new AxeBuilder({ page }).analyze()
  expect(metaStepResults.violations).toEqual([])

  await page.getByRole('link', { name: '← Back to dashboard' }).click()
  await expect(page.getByRole('heading', { name: 'Sales Guru' })).toBeVisible()
  await expect(page.getByText('Acme Widgets — Fashion / Jewelry · CDMX')).toBeVisible()

  const dashboardResults = await new AxeBuilder({ page }).analyze()
  expect(dashboardResults.violations).toEqual([])

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await expect(page.getByText('Acme Widgets — Fashion / Jewelry · CDMX')).toBeVisible()
})

// Dedicated coverage for the Brand ("brand DNA") onboarding step itself
// (PRD.md §5 step 3.5) — the combined flow above already exercises the
// happy path once; this isolates the required-field gate and the
// "editable later" round-trip so a regression in either fails here,
// unambiguously, rather than buried in the middle of the longer flow.
test('the Brand step blocks on required fields, then is editable later', async ({
  page,
}) => {
  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByLabel('Name').fill('Venzi Jewelry')
  await page.getByLabel('Industry').selectOption({ label: 'Fashion / Jewelry' })
  await page.getByRole('button', { name: 'Create business' }).click()

  await expect(page.getByRole('heading', { name: 'Brand' })).toBeVisible()

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

  // Saved — the Brand step gives way to the next one (campaign objective).
  await expect(page.getByText('No campaigns yet')).toBeVisible()

  // Complete the rest of onboarding so the fully-settled page (Campaigns
  // view) is reachable — that's where "editable later" is exercised.
  await page.getByLabel('Objective').selectOption({ label: 'Sales' })
  await page.getByRole('button', { name: 'Create campaign' }).click()
  await page.getByLabel('What do you sell?').fill('Handmade gold rings')
  await page.getByLabel('Price').fill('900')
  await page.getByLabel(/^URL/).fill('https://venzi.example/rings')
  await page.getByRole('button', { name: 'Add product' }).click()
  await page.getByLabel('Who buys?').fill('Self-purchasing women, 30-55')
  await page.getByRole('button', { name: 'Add audience' }).click()

  // Meta Ads is next and can't be completed here (real OAuth) — but
  // "Edit brand profile" must already be reachable regardless, since
  // it's not gated behind Meta the way the Campaigns view is.
  await expect(page.getByRole('heading', { name: 'Meta Ads' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit brand profile' }).click()
  await expect(page.getByLabel(/Brand overview/)).toHaveValue(
    'Family-run studio since 1985.',
  )

  await page.getByLabel('Tagline').fill('Wear your story')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('button', { name: 'Edit brand profile' })).toBeVisible()
})

test('signup rejects a duplicate email', async ({ page }) => {
  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign up' }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign up' }).click()

  await expect(page.getByRole('alert')).toHaveText('Email already registered')
})
