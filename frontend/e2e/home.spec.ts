import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('home page renders the Sales Guru heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sales Guru' })).toBeVisible()
})

test('home page has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})
