import { test, expect, type Page } from '@playwright/test'
import { createBusinessWithBrand } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'
import { E2E_API_URL } from './support/ports'

// The avatar research screens (Phase 7c). The whole suite runs with FAKE_LLM and
// AVATAR_RESEARCH_ENABLED (playwright.config.ts): the run a spec starts through the screen
// is played by a canned client, and POST .../research-runs/fake-seed makes a finished or
// running run in states a canned run does not reach. Nothing here makes a paid call.

async function businessId(page: Page): Promise<string> {
  await createBusinessWithBrand(page)
  const id = page.url().match(/businesses\/([^/?#]+)/)?.[1]
  expect(id).toBeTruthy()
  return id as string
}

async function seed(page: Page, id: string, body: Record<string, string> = {}) {
  const response = await page.request.post(`${E2E_API_URL}/businesses/${id}/research-runs/fake-seed`, {
    data: body,
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { id: string }
}

async function openAvatars(page: Page, id: string, search = '') {
  await page.goto(`/businesses/${id}${search}#avatars`)
  await expect(page.getByRole('tab', { name: 'Avatars' })).toHaveAttribute('aria-selected', 'true')
}

async function expectNoViolations(page: Page) {
  const results = await analyzeWhenReady(page, WCAG_TAGS)
  expect(results.violations).toEqual([])
}

test('start screen: choices, readiness, cost, and no accessibility violations', async ({ page }) => {
  const id = await businessId(page)
  await openAvatars(page, id)
  await page.getByRole('button', { name: 'Research avatars' }).click()
  await expect(page).toHaveURL(/\?research=new#avatars$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Research Avatars' })).toBeFocused()

  await expect(page.getByText(/research runs left this month/)).toBeVisible()
  const depth = page.getByRole('group', { name: /Research depth/ })
  await expect(depth.getByRole('radio', { name: /Standard/ })).toBeChecked()
  await expect(depth.getByText(/An extensive investigation/)).toBeVisible()

  // Only models the business may use are selectable; Fable 5.1 is shown but off.
  const model = page.getByRole('group', { name: /AI research model/ })
  await expect(model.getByRole('radio', { name: /Opus 5\.5/ })).toBeEnabled()
  await expect(model.getByRole('radio', { name: /Fable 5\.1/ })).toBeDisabled()
  await expect(model.getByText(/not enabled for this business/)).toBeVisible()

  // This business has no products or key messages, so the check names what is missing.
  const ready = page.getByRole('region', { name: 'Before you start' })
  await expect(ready.getByText('Key messages')).toBeVisible()
  await expect(ready.getByRole('link', { name: /Products tab/ }).first()).toHaveAttribute(
    'href',
    '#products',
  )
  await expect(page.getByRole('button', { name: 'Research anyway' })).toBeEnabled()

  await page.getByLabel(/Extra competitor web addresses/).fill('not a url')
  await expect(page.getByText(/is not a full web address/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Research anyway' })).toBeDisabled()
  await page.getByLabel(/Extra competitor web addresses/).fill('https://www.rivalring.com/rings')
  await expect(page.getByRole('button', { name: 'Research anyway' })).toBeEnabled()

  await expectNoViolations(page)
})

test('progress view: phase, counts, cancel, survives a refresh, and no violations', async ({ page }) => {
  const id = await businessId(page)
  const run = await seed(page, id, { status: 'running' })
  await openAvatars(page, id, `?research=${run.id}`)

  const progress = page.getByRole('region', { name: 'Research in progress' })
  await expect(progress.getByText('Looking for what customers say')).toBeVisible()
  await expect(progress).toContainText('4 of 15 searches')
  await expect(progress).toContainText('$0.42 spent so far')
  await expectNoViolations(page)

  await page.reload()
  await expect(page.getByRole('region', { name: 'Research in progress' })).toBeVisible()

  await page.getByRole('button', { name: 'Cancel research' }).click()
  await expect(page.getByText(/Stopping after the current step/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel research' })).toBeDisabled()
})

test('a research run started on the screen is watched, reviewed and saved to the library', async ({
  page,
}) => {
  const id = await businessId(page)
  await openAvatars(page, id, '?research=new')
  await page.getByLabel(/Extra competitor web addresses/).fill('https://www.rivalring.com/rings')
  await page.getByRole('radio', { name: /Light/ }).check()
  await expect(page.getByText(/research runs left this month/)).toBeVisible()
  await page.getByRole('button', { name: /Start Research|Research anyway/ }).click()

  // The canned run finishes quickly; the screen moves from progress to the review by itself.
  await expect(page.getByRole('heading', { level: 2, name: 'Review the research' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page).toHaveURL(/\?research=[^#]+#avatars$/)
  const runId = new URL(page.url()).searchParams.get('research') as string
  await expect(page.getByRole('region', { name: 'Evidence' })).toContainText('customer-voice')
  await expectNoViolations(page)

  const drafts = page.getByRole('list', { name: 'Avatar drafts' }).getByRole('listitem')
  await expect(drafts).toHaveCount(5)
  const first = drafts.first()
  await first.getByRole('checkbox', { name: /Save/ }).check()
  await first.getByText('Edit details').click()
  await first.getByLabel('Name', { exact: true }).fill('My Edited Avatar')
  await first.getByLabel('Who they buy for').selectOption('gift')
  await drafts.nth(1).getByRole('checkbox', { name: /Save/ }).check()
  await expect(page.getByText('2 selected')).toBeVisible()

  await page.getByRole('button', { name: 'Save selected' }).click()

  // Saving does not close the run: the two drafts turn into "Saved" with a library link,
  // and the rest can still be picked.
  await expect(drafts.nth(0).getByText('Saved')).toBeVisible()
  await expect(drafts.nth(1).getByText('Saved')).toBeVisible()
  await expect(drafts.nth(0).getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 2, name: 'Review the research' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark as done' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard' })).toHaveCount(0)
  await expectNoViolations(page)

  // Reopen the run (a refresh) and save a third from the same run.
  await page.reload()
  const reopened = page.getByRole('list', { name: 'Avatar drafts' }).getByRole('listitem')
  await expect(reopened.nth(0).getByText('Saved')).toBeVisible()
  await expect(reopened.nth(1).getByText('Saved')).toBeVisible()
  await reopened.nth(2).getByRole('checkbox', { name: /Save/ }).check()
  await page.getByRole('button', { name: 'Save selected' }).click()
  await expect(reopened.nth(2).getByText('Saved')).toBeVisible()

  // They are in the library, each tied to its run and draft; the run is still open.
  const avatars = (await (await page.request.get(`${E2E_API_URL}/businesses/${id}/avatars`)).json()) as {
    name: string
    purchaseFor: string
    sourceRunId: string | null
    concepts: unknown[]
  }[]
  expect(avatars).toHaveLength(3)
  expect(avatars.find((a) => a.name === 'My Edited Avatar')?.purchaseFor).toBe('gift')
  expect(avatars.every((a) => a.sourceRunId !== null && a.concepts.length > 0)).toBe(true)
  const runsOpen = (await (await page.request.get(`${E2E_API_URL}/businesses/${id}/research-runs`)).json()) as {
    status: string
  }[]
  expect(runsOpen[0].status).toBe('NEEDS_REVIEW')

  // Mark as done, after asking.
  await page.getByRole('button', { name: 'Mark as done' }).click()
  await page.getByRole('button', { name: 'Yes, mark as done' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Research done' })).toBeVisible()
  const saved = page.getByRole('list', { name: 'Avatars saved from this research' })
  await expect(saved.getByRole('listitem')).toHaveCount(3)
  await expect(saved).toContainText('My Edited Avatar')
  // The research itself stays readable on a done run: findings, and every draft marked Saved
  // or Not saved, with nothing to edit.
  await expect(page.getByRole('region', { name: 'Evidence' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Problems' })).toBeVisible()
  const doneDrafts = page.getByRole('list', { name: 'Avatar drafts' })
  await expect(doneDrafts.getByText('Saved', { exact: true })).toHaveCount(3)
  await expect(doneDrafts.getByText('Not saved', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save selected' })).toHaveCount(0)
  await expectNoViolations(page)
  const runs = (await (await page.request.get(`${E2E_API_URL}/businesses/${id}/research-runs`)).json()) as {
    status: string
  }[]
  expect(runs[0].status).toBe('REVIEWED')

  // Reopening a done run still shows what was saved, and a link goes to the library entry.
  await page.reload()
  await expect(page.getByRole('list', { name: 'Avatars saved from this research' }).getByRole('listitem')).toHaveCount(3)
  await page
    .getByRole('list', { name: 'Avatars saved from this research' })
    .getByRole('link', { name: 'My Edited Avatar' })
    .click()
  await expect(page.getByRole('listitem', { name: /^My Edited Avatar/ })).toBeFocused()

  // Reopen it, and the rest can be picked again.
  await openAvatars(page, id, `?research=${runId}`)
  await page.getByRole('button', { name: 'Reopen to save more' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Review the research' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark as done' })).toBeVisible()
  await page.getByRole('button', { name: 'Mark as done' }).click()
  await page.getByRole('button', { name: 'Yes, mark as done' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Research done' })).toBeVisible()

  await openAvatars(page, id)
  const table = page.getByRole('table', { name: 'Past research runs' })
  await expect(table).toContainText('Done')
  await expect(table.getByRole('row').nth(1).getByRole('cell').nth(2)).toHaveText('3')
})

test('review: low-evidence warning, competitor terms, unsaved-edit warning, discard', async ({ page }) => {
  const id = await businessId(page)
  const run = await seed(page, id, { evidence: 'low' })
  await openAvatars(page, id, `?research=${run.id}`)

  const evidence = page.getByRole('region', { name: 'Evidence' })
  await expect(evidence.getByText('Low evidence')).toBeVisible()
  await expect(evidence).toContainText('needs at least 6')
  await expect(page.getByText(/Ignored as common words: Spur/)).toBeVisible()
  await expectNoViolations(page)

  // A hook with a listed term is flagged; removing the term clears the flag.
  const flagged = page.getByText(/Contains a competitor term: Cartier/)
  await expect(flagged).toBeVisible()

  const leave = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
  expect(await leave()).toBe(false)
  await page.getByRole('button', { name: 'Remove term Cartier' }).click()
  await expect(flagged).toHaveCount(0)
  expect(await leave()).toBe(true)

  // Leaving by a link asks first; saying no stays here.
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toMatch(/unsaved changes/)
    void dialog.dismiss()
  })
  await page.evaluate(() => {
    const link = document.createElement('a')
    link.href = '/'
    link.textContent = 'Leave for home'
    document.body.append(link)
  })
  await page.getByRole('link', { name: 'Leave for home' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Review the research' })).toBeVisible()

  await page.getByRole('button', { name: 'Discard' }).click()
  await page.getByRole('button', { name: 'Yes, discard' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Research discarded' })).toBeVisible()
  // A discarded run's research can still be read, every draft Not saved.
  await expect(page.getByRole('list', { name: 'Problems' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Avatar drafts' }).getByText('Not saved', { exact: true })).not.toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expectNoViolations(page)
  const avatars = (await (await page.request.get(`${E2E_API_URL}/businesses/${id}/avatars`)).json()) as unknown[]
  expect(avatars).toHaveLength(0)
})

test('the library limit stops a save that would not fit', async ({ page }) => {
  const id = await businessId(page)
  for (let n = 0; n < 11; n += 1) {
    const response = await page.request.post(`${E2E_API_URL}/businesses/${id}/avatars`, {
      data: { name: `Existing ${n}`, who: 'Someone who buys.' },
    })
    expect(response.ok()).toBeTruthy()
  }
  const run = await seed(page, id)
  await openAvatars(page, id, `?research=${run.id}`)
  await expect(page.getByText(/11 of 12 avatar slots used; 1 left/)).toBeVisible()
  const drafts = page.getByRole('list', { name: 'Avatar drafts' }).getByRole('listitem')
  await drafts.nth(0).getByRole('checkbox', { name: /Save/ }).check()
  await drafts.nth(1).getByRole('checkbox', { name: /Save/ }).check()
  await expect(page.getByText(/only 1 slot left/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save selected' })).toBeDisabled()
})

test('the past research runs section stays at the bottom of the Avatars tab, and Open reaches a run', async ({
  page,
}) => {
  const id = await businessId(page)
  const run = await seed(page, id)

  // The address the owner lands on with the Meta step skipped: the section must be there.
  await openAvatars(page, id, '?metaLater=1')
  const library = page.getByRole('heading', { level: 2, name: 'Buyer avatars' })
  const table = page.getByRole('table', { name: 'Past research runs' })
  await expect(library).toBeVisible()
  await expect(table).toBeVisible()
  const [libraryBox, tableBox] = [await library.boundingBox(), await table.boundingBox()]
  expect(tableBox?.y ?? 0).toBeGreaterThan(libraryBox?.y ?? Infinity)
  await expectNoViolations(page)

  // Its Open button reaches the run, and the run's own page can be left again.
  await table.getByRole('button', { name: /^Open run from/ }).click()
  await expect(page).toHaveURL(new RegExp(`research=${run.id}`))
  await expect(page).toHaveURL(/metaLater=1/)
  await expect(page.getByRole('heading', { level: 2, name: 'Review the research' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Problems' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to avatars' }).click()
  await expect(page.getByRole('table', { name: 'Past research runs' })).toBeVisible()
})

async function addProduct(page: Page, id: string, name: string | null, description: string) {
  const response = await page.request.post(`${E2E_API_URL}/businesses/${id}/products`, {
    data: { description, ...(name ? { name } : {}) },
  })
  expect(response.ok()).toBe(true)
}

test('start screen: selection cards, the three-product limit and the live summary', async ({ page }) => {
  const id = await businessId(page)
  await addProduct(page, id, 'Emerald Coil', 'A coiled emerald ring in 18K gold.')
  await addProduct(page, id, 'Triangle Band', 'A triangle band with ceramic inlay.')
  await addProduct(page, id, null, 'An unnamed piece with a long description of its own.')
  await addProduct(page, id, 'Fourth Piece', 'The fourth product, left out by default.')
  await openAvatars(page, id, '?research=new')

  const summary = page.getByRole('region', { name: 'Your research configuration' })
  await expect(summary).toBeVisible()

  // Depth: a click anywhere on a card selects it, and the summary follows.
  const depth = page.getByRole('group', { name: /Research depth/ })
  // Near a corner, away from the middle: the whole card is the target.
  // Every depth shows the server's expected cost for the model and products chosen.
  await expect(depth.getByText(/^Expected \$\d/)).toHaveCount(3)
  await depth.getByRole('radio', { name: /Deep/ }).click({ position: { x: 8, y: 8 } })
  await expect(depth.getByRole('radio', { name: /Deep/ })).toBeChecked()
  await expect(summary.getByText('Research depth').locator('..')).toContainText('Deep')

  // Products: three are chosen for you, the fourth waits until one is removed.
  const products = page.getByRole('group', { name: /Products to research/ })
  await expect(products.getByText('3 of 3 selected')).toBeVisible()
  await expect(products.getByText(/maximum of three products/)).toBeVisible()
  await expect(products.getByRole('checkbox', { name: /Fourth Piece/ })).toBeDisabled()
  await expect(summary.getByRole('list', { name: 'Selected products' }).getByRole('listitem')).toHaveCount(3)
  await expect(summary.getByText('Untitled Product')).toBeVisible()

  await products.getByRole('checkbox', { name: /Triangle Band/ }).click({ position: { x: 8, y: 60 } })
  await expect(products.getByText('2 of 3 selected')).toBeVisible()
  await expect(products.getByText(/maximum of three products/)).toHaveCount(0)
  await products.getByRole('checkbox', { name: /Fourth Piece/ }).click({ position: { x: 8, y: 60 } })
  await expect(products.getByText('3 of 3 selected')).toBeVisible()
  await expect(summary.getByText('Fourth Piece')).toBeVisible()
  await expect(summary.getByText('Triangle Band')).toHaveCount(0)

  // The model the business may not use stays off.
  await expect(page.getByRole('radio', { name: /Fable 5\.1/ })).toBeDisabled()

  // The layout holds without sideways scrolling on a phone and a tablet.
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(page.getByRole('button', { name: /Start Research|Research anyway/ })).toBeVisible()
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await expectNoViolations(page)

  // Start sends the chosen depth and products.
  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && /\/research-runs$/.test(r.url()),
  )
  await page.getByRole('button', { name: /Start Research|Research anyway/ }).click()
  expect((await request).postDataJSON()).toMatchObject({ depth: 'deep', model: 'claude-opus-5-5' })
})
