import { test, expect } from '@playwright/test'
// Browser-only APIs used inside page.evaluate; keep DOM types out of the Node project.
interface BrowserRequest<T> {
  result: T
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}
interface BrowserTransaction {
  error: unknown
  oncomplete: (() => void) | null
  onabort: (() => void) | null
  objectStore(name: string): {
    getAll(): BrowserRequest<unknown[]>
    put(value: unknown): unknown
  }
}
interface BrowserDatabase {
  transaction(name: string | string[], mode?: 'readwrite'): BrowserTransaction
  close(): void
}
declare const indexedDB: {
  open(name: string, version?: number): BrowserRequest<BrowserDatabase>
}
declare const window: object

test('preserves the seeded workspace across reload', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'BrowserOS', exact: true }),
  ).toBeVisible()
  const snapshot = () =>
    page.evaluate(async () => {
      const database = await new Promise<BrowserDatabase>((resolve, reject) => {
        const request = indexedDB.open('browser-os')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise<unknown[]>((resolve, reject) => {
          const request = database
            .transaction('nodes')
            .objectStore('nodes')
            .getAll()
          request.onsuccess = () => resolve(request.result as unknown[])
          request.onerror = () => reject(request.error)
        })
      } finally {
        database.close()
      }
    })
  const before = await snapshot()
  expect(before).toHaveLength(6)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'BrowserOS', exact: true }),
  ).toBeVisible()
  expect(await snapshot()).toEqual(before)
})

test('denied storage requires an explicit temporary choice', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('Denied', 'SecurityError')
      },
    })
  })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Workspace unavailable' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeFocused()
  await expect(
    page.getByRole('navigation', { name: 'Application launcher' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Use a temporary workspace' }).click()
  await expect(page.getByRole('status')).toContainText('Temporary workspace')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  await expect(
    page.getByRole('region', { name: 'About BrowserOS window' }),
  ).toBeVisible()
})

test('orphaned contents block boot and are preserved', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'BrowserOS', exact: true }),
  ).toBeVisible()
  await page.evaluate(async () => {
    const request = indexedDB.open('browser-os')
    const database = await new Promise<BrowserDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result)
    })
    const tx = database.transaction('contents', 'readwrite')
    tx.objectStore('contents').put({ id: 'orphan', text: 'Do not erase' })
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
    database.close()
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('preserved')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Workspace unavailable' }),
  ).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Application launcher' }),
  ).toHaveCount(0)
})

test('a version change stops the active runtime and refuses an unsupported schema', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  await page.evaluate(async () => {
    const request = indexedDB.open('browser-os', 2)
    const database = await new Promise<BrowserDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
  })
  await expect(
    page.getByRole('heading', { name: 'Workspace unavailable' }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'About BrowserOS window' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('newer version')
})

for (const corruption of ['none', 'missing', 'wrong-size'] as const) {
  test(`checks persisted file text before readiness: ${corruption}`, async ({
    page,
  }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'BrowserOS', exact: true }),
    ).toBeVisible()
    await page.evaluate(async (corruption) => {
      const request = indexedDB.open('browser-os')
      const database = await new Promise<BrowserDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result)
      })
      const tx = database.transaction(
        ['nodes', 'contents', 'meta'],
        'readwrite',
      )
      const now = Date.now()
      tx.objectStore('nodes').put({
        id: 'boot-document',
        parentId: 'vfs-root',
        name: 'saved.txt',
        kind: 'file',
        contentId: 'boot-content',
        byteLength: 5,
        contentRevision: 1,
        metadataRevision: 1,
        mime: 'text/plain',
        metadata: { protected: false },
        createdAt: now,
        updatedAt: now,
      })
      tx.objectStore('meta').put({ key: 'totals', nodeCount: 7, textBytes: 5 })
      if (corruption !== 'missing')
        tx.objectStore('contents').put({
          id: 'boot-content',
          content: {
            kind: 'text',
            encoding: 'utf-8',
            text: corruption === 'wrong-size' ? 'changed' : 'hello',
          },
        })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
      })
      database.close()
    }, corruption)
    await page.reload()
    if (corruption === 'none')
      await expect(
        page.getByRole('heading', { name: 'BrowserOS', exact: true }),
      ).toBeVisible()
    else await expect(page.getByRole('alert')).toContainText('preserved')
  })
}
