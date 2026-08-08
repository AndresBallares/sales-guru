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

test('sign up, create a business, log out, log back in', async ({ page }) => {
  const email = uniqueEmail()
  const password = 'supersecret123'

  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign up' }).click()

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await expect(page.getByText('No businesses yet')).toBeVisible()

  await page.getByLabel('Nombre').fill('Acme Widgets')
  await page.getByLabel('Industria').fill('Manufacturing')
  await page.getByLabel('Ubicación').fill('CDMX')
  await page.getByRole('button', { name: 'Create business' }).click()

  await expect(page.getByText('Acme Widgets — Manufacturing · CDMX')).toBeVisible()

  const dashboardResults = await new AxeBuilder({ page }).analyze()
  expect(dashboardResults.violations).toEqual([])

  await page.getByRole('link', { name: 'Acme Widgets' }).click()
  await expect(page.getByRole('heading', { name: 'Acme Widgets' })).toBeVisible()
  await expect(page.getByText('No products yet')).toBeVisible()

  await page.getByLabel('What do you sell?').fill('Handmade leather wallets')
  await page.getByLabel('Price').fill('49.99')
  await page.getByRole('button', { name: 'Add product' }).click()

  await expect(page.getByText('Handmade leather wallets')).toBeVisible()

  await expect(page.getByText('No audiences yet')).toBeVisible()
  await page.getByLabel('Who buys?').fill('Busy professionals, 30-55')
  await page.getByLabel('Age min').fill('30')
  await page.getByLabel('Age max').fill('55')
  await page.getByLabel('Location').fill('New York')
  await page.getByRole('button', { name: 'Add audience' }).click()

  await expect(page.getByText('Busy professionals, 30-55')).toBeVisible()

  await expect(page.getByText('No campaigns yet')).toBeVisible()
  // Focusing the dropdowns triggers a refetch (see CampaignsSection) so the
  // product/audience just created above actually appear as options.
  await page.getByLabel('Product').focus()
  await page.getByLabel('Product').selectOption({ label: 'Handmade leather wallets' })
  await page.getByLabel('Audience').selectOption({ label: 'Busy professionals, 30-55' })
  await page.getByLabel('Objective').selectOption({ label: 'Ventas' })
  await page.getByRole('button', { name: 'Create campaign' }).click()

  await expect(page.getByText('Ventas — DRAFT')).toBeVisible()

  const businessDetailResults = await new AxeBuilder({ page }).analyze()
  expect(businessDetailResults.violations).toEqual([])

  await page.getByRole('link', { name: '← Back to dashboard' }).click()
  await expect(page.getByRole('heading', { name: 'Sales Guru' })).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await expect(page.getByText('Acme Widgets — Manufacturing · CDMX')).toBeVisible()
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
