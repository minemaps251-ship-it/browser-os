import { test, expect } from '@playwright/test'
// Browser-only APIs used inside page.evaluate; keep DOM types out of the Node project.
interface BrowserRequest<T> {
  result: T
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onblocked: (() => void) | null
  onupgradeneeded: (() => void) | null
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
  createObjectStore(
    name: string,
    options: { keyPath: string },
  ): { put(value: unknown): unknown }
}
declare const indexedDB: {
  open(name: string, version?: number): BrowserRequest<BrowserDatabase>
  deleteDatabase(name: string): BrowserRequest<unknown>
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
  const contents = () =>
    page.evaluate(async () => {
      const request = indexedDB.open('browser-os')
      const database = await new Promise<BrowserDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result)
      })
      try {
        return await new Promise<unknown[]>((resolve, reject) => {
          const query = database
            .transaction('contents')
            .objectStore('contents')
            .getAll()
          query.onsuccess = () => resolve(query.result)
          query.onerror = () => reject(query.error)
        })
      } finally {
        database.close()
      }
    })
  expect(await contents()).toEqual([{ id: 'orphan', text: 'Do not erase' }])
  await page.getByRole('button', { name: 'Use a temporary workspace' }).click()
  await expect(
    page.getByRole('heading', { name: 'BrowserOS', exact: true }),
  ).toBeVisible()
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('dark')
  expect(await contents()).toEqual([{ id: 'orphan', text: 'Do not erase' }])
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('browser-os')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () =>
          reject(new Error('Recovery leaked a connection'))
      }),
  )
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

test('incompatible schema retries preserve data and release their connections', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const request = indexedDB.open('browser-os', 1)
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore('legacy', { keyPath: 'id' })
        .put({ id: 'original', text: 'Keep this data' })
    }
    request.onsuccess = () => request.result.close()
  })
  await page.goto('/')
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(
      page.getByRole('heading', { name: 'Workspace format is incompatible' }),
    ).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('preserved')
    if (attempt < 2) {
      const retry = page.getByRole('button', { name: 'Retry', exact: true })
      const previousButton = await retry.elementHandle()
      await retry.click()
      // The old error can remain visible until React renders the loading state.
      // Wait for that attempt's button to disappear before accepting the next error.
      await previousButton?.waitForElementState('hidden')
    }
  }
  await page.evaluate(async () => {
    const request = indexedDB.open('browser-os')
    const database = await new Promise<BrowserDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result)
    })
    const transaction = database.transaction('legacy')
    const finished = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
    const query = transaction.objectStore('legacy').getAll()
    const records = await new Promise<unknown[]>((resolve, reject) => {
      query.onsuccess = () => resolve(query.result)
      query.onerror = () => reject(query.error)
    })
    // Request success precedes transaction completion. Release the inspection read
    // before testing whether boot left any connections open.
    await finished
    database.close()
    if (
      JSON.stringify(records) !==
      JSON.stringify([{ id: 'original', text: 'Keep this data' }])
    )
      throw new Error('Original data changed')
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase('browser-os')
      deletion.onsuccess = () => resolve()
      deletion.onerror = () => reject(deletion.error)
      deletion.onblocked = () =>
        reject(new Error('Failed boot leaked a connection'))
    })
  })
})
