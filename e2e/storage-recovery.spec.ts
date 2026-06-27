import { expect, test } from '@playwright/test'

test('retry after denied storage reaches the saved workspace without implicit memory', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const factory = (globalThis as unknown as { indexedDB: unknown }).indexedDB
    let denied = true
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        if (denied) {
          denied = false
          throw new DOMException('Denied', 'SecurityError')
        }
        return factory
      },
    })
  })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Browser storage unavailable' }),
  ).toBeVisible()
  await expect(page.getByText(/Allow storage for this site/)).toBeVisible()
  const retry = page.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeFocused()
  await retry.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'BrowserOS', exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/Temporary workspace —/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  await page.getByText('Storage and recovery', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Browser storage is not a backup/)).toBeVisible()
})

for (const failure of ['blocked', 'timeout'] as const) {
  test(`${failure} has specific guidance and retry uses the native database`, async ({
    page,
  }) => {
    await page.addInitScript((failure) => {
      const factory = (
        globalThis as unknown as {
          indexedDB: { open(name: string, version?: number): unknown }
        }
      ).indexedDB
      const original = factory.open.bind(factory)
      let fail = true
      Object.defineProperty(factory, 'open', {
        configurable: true,
        value(name: string, version?: number) {
          if (!fail) return original(name, version)
          fail = false
          const request: { onblocked: (() => void) | null } = {
            onblocked: null,
          }
          if (failure === 'blocked') setTimeout(() => request.onblocked?.(), 0)
          return request
        },
      })
    }, failure)
    await page.goto('/')
    await expect(
      page.getByRole('heading', {
        name:
          failure === 'blocked' ? 'Workspace is busy' : 'Opening took too long',
      }),
    ).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'BrowserOS', exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/Temporary workspace —/)).toHaveCount(0)
  })
}

test('a SecurityError from opening storage shows permission guidance', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const factory = (globalThis as unknown as { indexedDB: { open: unknown } })
      .indexedDB
    Object.defineProperty(factory, 'open', {
      configurable: true,
      value() {
        throw new DOMException('Denied', 'SecurityError')
      },
    })
  })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Browser storage unavailable' }),
  ).toBeVisible()
  await expect(page.getByText(/Allow storage for this site/)).toBeVisible()
})
