import { test, expect, type Page } from '@playwright/test'
import { createBusinessWithBrand } from './support/fakeMetaFlow'
import { analyzeWhenReady, WCAG_TAGS } from './support/axe'
import { E2E_API_URL } from './support/ports'

// The Avatars tab on the business page. No model or Meta call is made: the avatars are made
// through the API, and everything else is the app's own screens (FAKE_LLM, see
// playwright.config.ts, is on for the whole suite).

const NAMES = ['The Promotion Ring Buyer', 'The Deadline Gift-Giver', 'The Heirloom Commissioner']

async function businessWithAvatars(page: Page) {
  await createBusinessWithBrand(page)
  const businessId = page.url().match(/businesses\/([^/?#]+)/)?.[1]
  expect(businessId).toBeTruthy()
  const url = `${E2E_API_URL}/businesses/${businessId}/avatars`
  for (const [index, name] of NAMES.entries()) {
    const response = await page.request.post(url, {
      data: { name, who: `${name} buys fine jewelry.`, purchaseFor: index === 1 ? 'gift' : 'self' },
    })
    expect(response.ok()).toBeTruthy()
  }
  await page.reload()
  return { url }
}

// Everything an avatar can do sits in its card's three-dot menu.
async function chooseAction(page: Page, avatarName: string, action: string) {
  await page.getByRole('button', { name: `More actions for ${avatarName}` }).click()
  await page.getByRole('menuitem', { name: action }).click()
}

async function shownNames(page: Page) {
  return page.getByRole('list', { name: 'Buyer avatars' }).getByRole('heading').allTextContents()
}

async function apiAvatars(page: Page, url: string, query = '') {
  return (await (await page.request.get(`${url}${query}`)).json()) as {
    name: string
    isActive: boolean
    purchaseFor: string
    deletedAt: string | null
  }[]
}

test('the selected tab is kept in the URL, so a refresh or a link opens the same tab', async ({
  page,
}) => {
  await businessWithAvatars(page)
  const resultsTab = page.getByRole('tab', { name: 'Results and campaigns' })
  const avatarsTab = page.getByRole('tab', { name: 'Avatars' })
  await expect(resultsTab).toHaveAttribute('aria-selected', 'true')

  await avatarsTab.click()
  await expect(page).toHaveURL(/#avatars$/)
  await expect(page.getByRole('heading', { name: 'AI Customer Avatars', level: 2 })).toBeVisible()

  await page.reload()
  await expect(avatarsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'AI Customer Avatars', level: 2 })).toBeVisible()

  // Arrow keys move between the tabs (and focus with them), and the hash follows.
  await avatarsTab.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(resultsTab).toBeFocused()
  await expect(resultsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page).not.toHaveURL(/#avatars/)
})

test('the back button on the Avatars tab returns to the business page without #avatars', async ({
  page,
}) => {
  await businessWithAvatars(page)
  const businessUrl = page.url().split('#')[0]
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect(page).toHaveURL(/#avatars$/)
  await expect(page.getByRole('heading', { name: 'AI Customer Avatars', level: 2 })).toBeVisible()

  await page.getByRole('button', { name: 'Back to business page' }).click()

  await expect(page).toHaveURL(businessUrl)
  await expect(page.getByRole('tab', { name: 'Results and campaigns' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('heading', { name: 'AI Customer Avatars', level: 2 })).toHaveCount(0)
  // A refresh stays on the business page, and its back button goes to the dashboard again.
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Results and campaigns' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('button', { name: 'Back to dashboard' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('lists, edits, reorders, deactivates and deletes avatars', async ({ page }) => {
  const { url } = await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect.poll(() => shownNames(page)).toEqual(NAMES)

  // Edit: every field is there, including who the avatar buys for.
  await chooseAction(page, 'The Promotion Ring Buyer', 'Edit avatar')
  const form = page.getByRole('form', { name: 'Edit The Promotion Ring Buyer' })
  await expect(form.getByLabel('Buys for')).toHaveValue('self')
  await form.getByLabel('Name').fill('Milestone Buyer')
  await form.getByLabel('Buys for').selectOption('gift')
  await form
    .getByLabel('Hooks')
    .fill('Color that survives your commute.\nThe ring people ask about.')
  await form.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { name: 'Milestone Buyer' })).toBeVisible()
  await expect(form).toHaveCount(0)
  const saved = await apiAvatars(page, url)
  expect(saved[0]).toMatchObject({ name: 'Milestone Buyer', purchaseFor: 'gift' })

  // Reorder: the first one moves down; the order is saved.
  await chooseAction(page, 'Milestone Buyer', 'Move down')
  await expect.poll(() => shownNames(page)).toEqual([NAMES[1], 'Milestone Buyer', NAMES[2]])
  // The cards move at once; the save follows, so wait for the saved order.
  await expect
    .poll(async () => (await apiAvatars(page, url)).map((a) => a.name))
    .toEqual([NAMES[1], 'Milestone Buyer', NAMES[2]])
  await expect(page.getByRole('button', { name: /^Reorder Milestone Buyer/ })).toBeFocused()

  // Deactivate, then activate again.
  await chooseAction(page, 'Milestone Buyer', 'Deactivate avatar')
  const item = page.getByRole('listitem', { name: 'Milestone Buyer' })
  await expect(item.getByText('Inactive')).toBeVisible()
  expect((await apiAvatars(page, url)).find((a) => a.name === 'Milestone Buyer')?.isActive).toBe(
    false,
  )
  await chooseAction(page, 'Milestone Buyer', 'Activate avatar')
  await expect(item.getByText('Inactive')).toHaveCount(0)

  // Delete asks first: cancelling keeps it, confirming soft-deletes it.
  await chooseAction(page, 'The Heirloom Commissioner', 'Delete avatar')
  const confirm = page.getByRole('group', { name: 'Confirm deleting The Heirloom Commissioner' })
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  expect(await shownNames(page)).toContain(NAMES[2])

  await chooseAction(page, 'The Heirloom Commissioner', 'Delete avatar')
  await confirm.getByRole('button', { name: 'Delete avatar' }).click()
  await expect.poll(() => shownNames(page)).toEqual([NAMES[1], 'Milestone Buyer'])
  await expect(page.getByRole('heading', { name: 'AI Customer Avatars', level: 2 })).toBeFocused()
  expect((await apiAvatars(page, url)).map((a) => a.name)).toEqual([NAMES[1], 'Milestone Buyer'])
  const withDeleted = await apiAvatars(page, url, '?includeDeleted=true')
  expect(withDeleted.find((a) => a.name === NAMES[2])?.deletedAt).not.toBeNull()
})

test('the Avatars tab passes the axe checks with an edit form open, and with a delete confirmation open', async ({
  page,
}) => {
  await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect(page.getByRole('heading', { name: 'AI Customer Avatars', level: 2 })).toBeVisible()
  await expect.poll(() => shownNames(page)).toEqual(NAMES)
  await page.getByRole('button', { name: 'Import from document' }).click()

  await chooseAction(page, 'The Promotion Ring Buyer', 'Edit avatar')
  await expect(page.getByRole('form', { name: 'Edit The Promotion Ring Buyer' })).toBeVisible()
  expect((await analyzeWhenReady(page, WCAG_TAGS)).violations).toEqual([])

  await chooseAction(page, 'The Deadline Gift-Giver', 'Delete avatar')
  await expect(
    page.getByRole('group', { name: 'Confirm deleting The Deadline Gift-Giver' }),
  ).toBeVisible()
  expect((await analyzeWhenReady(page, WCAG_TAGS)).violations).toEqual([])
})

test('adds ad concepts to an avatar, saves them, and the edit form with concepts passes axe', async ({
  page,
}) => {
  const { url } = await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect.poll(() => shownNames(page)).toEqual(NAMES)

  await chooseAction(page, 'The Promotion Ring Buyer', 'Edit avatar')
  const form = page.getByRole('form', { name: 'Edit The Promotion Ring Buyer' })
  await form.getByRole('button', { name: 'Add concept' }).click()
  await form.getByLabel('Concept 1 name').fill('Last-minute rescue')
  await form.getByLabel('Concept 1 pillar').selectOption('offer')
  await form.getByLabel('Concept 1 description').fill('Still time to give a gift that looks chosen')
  expect((await analyzeWhenReady(page, WCAG_TAGS)).violations).toEqual([])

  await form.getByRole('button', { name: 'Save changes' }).click()
  await expect(form).toHaveCount(0)

  const stored = (await (await page.request.get(url)).json()) as {
    name: string
    concepts: { slug: string; pillar: string; description: string }[]
  }[]
  expect(stored.find((a) => a.name === 'The Promotion Ring Buyer')?.concepts).toEqual([
    {
      slug: 'last-minute-rescue',
      pillar: 'offer',
      description: 'Still time to give a gift that looks chosen',
    },
  ])

  // Opening it again shows the concept, with the slug read back as a name.
  await chooseAction(page, 'The Promotion Ring Buyer', 'Edit avatar')
  await expect(page.getByLabel('Concept 1 name')).toHaveValue('last minute rescue')
})

test('drag and drop reorders the cards, renumbers them, and the order survives a reload', async ({
  page,
}) => {
  const { url } = await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect.poll(() => shownNames(page)).toEqual(NAMES)
  const first = page.getByRole('listitem', { name: NAMES[0] })
  const last = page.getByRole('listitem', { name: NAMES[2] })
  await expect(first).toContainText('01')

  await first.getByRole('button', { name: /^Reorder/ }).dragTo(last)

  await expect.poll(() => shownNames(page)).toEqual([NAMES[1], NAMES[2], NAMES[0]])
  await expect(page.getByRole('listitem', { name: NAMES[0] })).toContainText('03')
  await expect
    .poll(async () => (await apiAvatars(page, url)).map((a) => a.name))
    .toEqual([NAMES[1], NAMES[2], NAMES[0]])
  await page.reload()
  await expect.poll(() => shownNames(page)).toEqual([NAMES[1], NAMES[2], NAMES[0]])
})

test('the arrow keys on a handle reorder, and Past research runs stays below the cards', async ({
  page,
}) => {
  const { url } = await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect.poll(() => shownNames(page)).toEqual(NAMES)

  const handle = page.getByRole('button', { name: new RegExp(`^Reorder ${NAMES[0]}`) })
  await handle.focus()
  await page.keyboard.press('ArrowDown')

  await expect.poll(() => shownNames(page)).toEqual([NAMES[1], NAMES[0], NAMES[2]])
  await expect(handle).toBeFocused()
  await expect
    .poll(async () => (await apiAvatars(page, url)).map((a) => a.name))
    .toEqual([NAMES[1], NAMES[0], NAMES[2]])
  // Whatever research shows on this tab sits after the last card (it is absent when research is off).
  const list = page.getByRole('list', { name: 'Buyer avatars' })
  const entry = page.getByRole('heading', { name: 'Research new avatars' })
  if (await entry.count()) {
    const listBox = await list.boundingBox()
    const entryBox = await entry.boundingBox()
    expect(entryBox!.y).toBeGreaterThan(listBox!.y + listBox!.height - 1)
  }
})

test('the cards use three columns on a wide screen, one on a phone, and never scroll sideways', async ({
  page,
}) => {
  await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect.poll(() => shownNames(page)).toEqual(NAMES)

  await page.setViewportSize({ width: 1280, height: 900 })
  const xs = await page
    .getByRole('list', { name: 'Buyer avatars' })
    .getByRole('listitem')
    .evaluateAll((items) => items.map((li) => Math.round(li.getBoundingClientRect().x)))
  expect(new Set(xs).size).toBe(3)

  await page.setViewportSize({ width: 390, height: 800 })
  const mobileXs = await page
    .getByRole('list', { name: 'Buyer avatars' })
    .getByRole('listitem')
    .evaluateAll((items) => items.map((li) => Math.round(li.getBoundingClientRect().x)))
  expect(new Set(mobileXs).size).toBe(1)
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(scrolls).toBe(false)
})

test('the Research avatars (AI) button has clear space above it, and only that button', async ({
  page,
}) => {
  await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  const research = page.getByRole('button', { name: 'Research avatars (AI)' })
  await expect(research).toBeVisible()
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const gap = await research.evaluate((button) => {
      const hint = button.parentElement?.querySelector(':scope > .field-hint')
      return button.getBoundingClientRect().top - (hint?.getBoundingClientRect().bottom ?? 0)
    })
    expect(gap).toBeGreaterThanOrEqual(15)
    // Other buttons keep their own spacing: the card menu button gets no top margin.
    const others = await page
      .getByRole('button', { name: /^More actions for/ })
      .first()
      .evaluate((b) => getComputedStyle(b).marginTop)
    expect(others).toBe('0px')
  }
})

test('Create avatar saves a new card at the end of the order', async ({ page }) => {
  const { url } = await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect.poll(() => shownNames(page)).toEqual(NAMES)

  await page.getByRole('button', { name: 'Create avatar' }).click()
  const form = page.getByRole('form', { name: 'New buyer avatar' })
  await form.getByLabel('Name').fill('The Anniversary Buyer')
  await form.getByLabel('Who they are').fill('Marks every year with a ring.')
  await form.getByRole('button', { name: 'Save avatar' }).click()

  await expect.poll(() => shownNames(page)).toEqual([...NAMES, 'The Anniversary Buyer'])
  await expect(page.getByText('4 of 12 avatars')).toBeVisible()
  expect((await apiAvatars(page, url)).map((a) => a.name)).toEqual([...NAMES, 'The Anniversary Buyer'])
})
