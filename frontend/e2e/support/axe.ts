import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

// The tag set the accessibility checks that go beyond axe's defaults use.
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

// Run axe on the page as it is now, once it has rendered. page.goto() returns
// when the document loads, but this is a single-page app: the shell can still be
// empty then, and axe reports a missing <main> that is only "missing" because
// React has not mounted yet (it failed one run under load, 2026-10-31).
export async function analyzeWhenReady(page: Page, tags?: string[]) {
  await expect(page.locator('main').first()).toBeVisible()
  const builder = new AxeBuilder({ page })
  return (tags ? builder.withTags(tags) : builder).analyze()
}
