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
  await expect(page.getByRole('heading', { name: 'Buyer avatars', level: 2 })).toBeVisible()

  await page.reload()
  await expect(avatarsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Buyer avatars', level: 2 })).toBeVisible()

  // Arrow keys move between the tabs (and focus with them), and the hash follows.
  await avatarsTab.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(resultsTab).toBeFocused()
  await expect(resultsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page).not.toHaveURL(/#avatars/)
})

test('lists, edits, reorders, deactivates and deletes avatars', async ({ page }) => {
  const { url } = await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect.poll(() => shownNames(page)).toEqual(NAMES)

  // Edit: every field is there, including who the avatar buys for.
  await page.getByRole('button', { name: 'Edit The Promotion Ring Buyer' }).click()
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
  await page.getByRole('button', { name: 'Move down Milestone Buyer' }).click()
  await expect.poll(() => shownNames(page)).toEqual([NAMES[1], 'Milestone Buyer', NAMES[2]])
  expect((await apiAvatars(page, url)).map((a) => a.name)).toEqual([
    NAMES[1],
    'Milestone Buyer',
    NAMES[2],
  ])
  await expect(page.getByRole('button', { name: 'Move down Milestone Buyer' })).toBeFocused()

  // Deactivate, then activate again.
  await page.getByRole('button', { name: 'Deactivate Milestone Buyer' }).click()
  const item = page.getByRole('listitem', { name: 'Milestone Buyer' })
  await expect(item.getByText('Inactive')).toBeVisible()
  expect((await apiAvatars(page, url)).find((a) => a.name === 'Milestone Buyer')?.isActive).toBe(
    false,
  )
  await page.getByRole('button', { name: 'Activate Milestone Buyer' }).click()
  await expect(item.getByText('Inactive')).toHaveCount(0)

  // Delete asks first: cancelling keeps it, confirming soft-deletes it.
  await page.getByRole('button', { name: 'Delete The Heirloom Commissioner' }).click()
  const confirm = page.getByRole('group', { name: 'Confirm deleting The Heirloom Commissioner' })
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  expect(await shownNames(page)).toContain(NAMES[2])

  await page.getByRole('button', { name: 'Delete The Heirloom Commissioner' }).click()
  await confirm.getByRole('button', { name: 'Delete avatar' }).click()
  await expect.poll(() => shownNames(page)).toEqual([NAMES[1], 'Milestone Buyer'])
  await expect(page.getByRole('heading', { name: 'Buyer avatars', level: 2 })).toBeFocused()
  expect((await apiAvatars(page, url)).map((a) => a.name)).toEqual([NAMES[1], 'Milestone Buyer'])
  const withDeleted = await apiAvatars(page, url, '?includeDeleted=true')
  expect(withDeleted.find((a) => a.name === NAMES[2])?.deletedAt).not.toBeNull()
})

test('the Avatars tab passes the axe checks with an edit form open, and with a delete confirmation open', async ({
  page,
}) => {
  await businessWithAvatars(page)
  await page.getByRole('tab', { name: 'Avatars' }).click()
  await expect(page.getByRole('heading', { name: 'Buyer avatars', level: 2 })).toBeVisible()
  await expect.poll(() => shownNames(page)).toEqual(NAMES)
  await page.getByText('Import buyer avatars from research').click()

  await page.getByRole('button', { name: 'Edit The Promotion Ring Buyer' }).click()
  await expect(page.getByRole('form', { name: 'Edit The Promotion Ring Buyer' })).toBeVisible()
  expect((await analyzeWhenReady(page, WCAG_TAGS)).violations).toEqual([])

  await page.getByRole('button', { name: 'Delete The Deadline Gift-Giver' }).click()
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

  await page.getByRole('button', { name: 'Edit The Promotion Ring Buyer' }).click()
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
  await page.getByRole('button', { name: 'Edit The Promotion Ring Buyer' }).click()
  await expect(page.getByLabel('Concept 1 name')).toHaveValue('last minute rescue')
})
