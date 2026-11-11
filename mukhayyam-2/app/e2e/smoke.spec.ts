import { expect, test, type Page } from '@playwright/test'

// Every main page opens for the people who use it, without a crash screen or a console error.
// Runs on the demo build (sample accounts, PIN 123456).

const PIN = '123456'

async function login(page: Page, phone: string) {
  await page.goto('/login')
  await page.locator('#phone').fill(phone)
  // The sixth digit signs in by itself.
  await page.locator('#pin').fill(PIN)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    // The demo build has no server; a failed fetch is not a page bug.
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  return errors
}

async function visit(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  // The crash screen, the 404 screen and «not your page» all mean the page did not open.
  for (const t of ['حدث خطأ غير متوقع', 'الصفحة غير موجودة', 'هذه الصفحة ليست ضمن صلاحياتك'])
    await expect(page.getByRole('heading', { name: t }), `${path}: ${t}`).toHaveCount(0)
  await expect(page.locator('#root')).not.toBeEmpty()
}

test('the manager opens every page', async ({ page }) => {
  const errors = watchErrors(page)
  await login(page, '0590000002')
  for (const path of ['/', '/generation', '/distribution', '/tasks', '/attendance', '/readings', '/reports', '/settings', '/settings?tab=sms', '/account', '/more', '/guide', '/subscriber'])
    await visit(page, path)
  expect(errors).toEqual([])
})

test('the generation site opens on its report', async ({ page }) => {
  const errors = watchErrors(page)
  await login(page, '0590000003')
  await visit(page, '/')
  await expect(page.getByText(/تقرير|التوليد/).first()).toBeVisible()
  await visit(page, '/history')
  expect(errors).toEqual([])
})

test('the distribution supervisor opens the sheet', async ({ page }) => {
  const errors = watchErrors(page)
  await login(page, '0590000004')
  await visit(page, '/')
  await visit(page, '/sheet')
  expect(errors).toEqual([])
})

test('a technician opens his tasks and attendance', async ({ page }) => {
  const errors = watchErrors(page)
  await login(page, '0590000005')
  await visit(page, '/')
  await visit(page, '/my-attendance')
  await visit(page, '/guide')
  await expect(page.getByRole('heading', { name: 'مهامي (الفني)' })).toBeVisible()
  expect(errors).toEqual([])
})
