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
