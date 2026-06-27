import { expect, test, type Page } from '@playwright/test'
// These declarations describe browser APIs inside evaluate without importing DOM into the Node project.
interface BrowserRequest<T> {
  result: T
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  addEventListener(
    type: 'success',
    listener: () => void,
    options?: { once: boolean },
  ): void
}
interface BrowserStore {
  name: string
  transaction: BrowserTransaction
  get(key: string): BrowserRequest<unknown>
  put(value: unknown): BrowserRequest<unknown>
  delete(key: string): BrowserRequest<unknown>
}
interface BrowserTransaction {
  error: unknown
  oncomplete: (() => void) | null
  onabort: (() => void) | null
  objectStore(name: string): BrowserStore
  abort(): void
}
interface BrowserDatabase {
  transaction(name: string, mode?: 'readwrite'): BrowserTransaction
  close(): void
}
declare const indexedDB: { open(name: string): BrowserRequest<BrowserDatabase> }

async function themeRecord(
  page: Page,
  action: 'get' | 'put' | 'delete',
  value?: unknown,
) {
  return page.evaluate(
    async ({ action, value }) => {
      const request = indexedDB.open('browser-os')
      const database = await new Promise<BrowserDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        const tx = database.transaction(
          'settings',
          action === 'get' ? undefined : 'readwrite',
        )
        const complete = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve()
          tx.onabort = () => reject(tx.error)
        })
        const store = tx.objectStore('settings')
        const operation =
          action === 'get'
            ? store.get('theme')
            : action === 'put'
              ? store.put(value)
              : store.delete('theme')
        const result = await new Promise<unknown>((resolve, reject) => {
          operation.onsuccess = () => resolve(operation.result)
          operation.onerror = () => reject(operation.error)
        })
        await complete
        return result
      } finally {
        database.close()
      }
    },
    { action, value },
  )
}

test('persists an explicit theme, follows system changes, and keeps manual choice', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const choice = page.getByRole('combobox', { name: 'Appearance' })
  await expect(choice).toHaveValue('system')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await choice.focus()
  await page.keyboard.press('d')
  await page.keyboard.press('Enter')
  await expect(choice).toHaveValue('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  expect(await themeRecord(page, 'get')).toEqual({
    key: 'theme',
    schemaVersion: 1,
    value: 'dark',
  })
  await page.reload()
  await expect(choice).toHaveValue('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await choice.selectOption('system')
  await expect(choice).toHaveValue('system')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await choice.selectOption('light')
  await expect(choice).toHaveValue('light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
})

test('uses an absent setting without creating a record', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Appearance' })).toBeVisible()
  await themeRecord(page, 'delete')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Appearance' })).toHaveValue(
    'system',
  )
  expect(await themeRecord(page, 'get')).toBeUndefined()
})

test('preserves an invalid setting until the user explicitly replaces it', async ({
  page,
}) => {
  await page.goto('/')
  const choice = page.getByRole('combobox', { name: 'Appearance' })
  await expect(choice).toBeVisible()
  const invalid = { key: 'theme', schemaVersion: 99, value: 'unsupported' }
  await themeRecord(page, 'put', invalid)
  await page.reload()
  await expect(choice).toHaveValue('system')
  await expect(page.getByRole('alert')).toContainText('invalid')
  expect(await themeRecord(page, 'get')).toEqual(invalid)
  await choice.selectOption('light')
  await expect(choice).toHaveValue('light')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await themeRecord(page, 'get')).toEqual({
    key: 'theme',
    schemaVersion: 1,
    value: 'light',
  })
})

for (const failure of ['quota', 'abort'] as const) {
  test(`failed ${failure} save retains the committed appearance and allows retry`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    const choice = page.getByRole('combobox', { name: 'Appearance' })
    await expect(choice).toBeVisible()
    await page.evaluate(async (failure) => {
      const request = indexedDB.open('browser-os')
      const database = await new Promise<BrowserDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result)
      })
      const store = database.transaction('settings').objectStore('settings')
      const prototype = Object.getPrototypeOf(store) as {
        put: BrowserStore['put']
      }
      const original = prototype.put
      let fail = true
      prototype.put = function (this: BrowserStore, value: unknown) {
        if (this.name !== 'settings' || !fail) return original.call(this, value)
        fail = false
        if (failure === 'quota')
          throw new DOMException('Injected quota', 'QuotaExceededError')
        const request = original.call(this, value)
        request.addEventListener('success', () => this.transaction.abort(), {
          once: true,
        })
        return request
      }
      database.close()
    }, failure)
    await choice.selectOption('dark')
    await expect(page.getByRole('alert')).toContainText('retry')
    if (failure === 'quota')
      await expect(page.getByRole('alert')).toContainText('storage is full')
    await expect(choice).toHaveValue('system')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await themeRecord(page, 'get')).toEqual({
      key: 'theme',
      schemaVersion: 1,
      value: 'system',
    })
    await choice.selectOption('dark')
    await expect(choice).toHaveValue('dark')
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await themeRecord(page, 'get')).toEqual({
      key: 'theme',
      schemaVersion: 1,
      value: 'dark',
    })
  })
}

test('temporary appearance changes do not survive reload', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('Denied', 'SecurityError')
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Use a temporary workspace' }).click()
  const choice = page.getByRole('combobox', { name: 'Appearance' })
  await choice.selectOption('dark')
  await expect(choice).toHaveValue('dark')
  await page.reload()
  await page.getByRole('button', { name: 'Use a temporary workspace' }).click()
  await expect(choice).toHaveValue('system')
})

test('keeps the appearance selector and clock reachable on a small screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  const choice = page.getByRole('combobox', { name: 'Appearance' })
  await expect(choice).toBeInViewport()
  await expect(page.locator('header time')).toBeInViewport()
  await choice.selectOption('dark')
  await expect(choice).toHaveValue('dark')
  const choiceBox = await choice.boundingBox()
  const clockBox = await page.locator('header time').boundingBox()
  expect(choiceBox).not.toBeNull()
  expect(clockBox).not.toBeNull()
  expect(choiceBox!.x + choiceBox!.width).toBeLessThanOrEqual(clockBox!.x)
})
