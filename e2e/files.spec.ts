import { expect, test } from '@playwright/test'
interface Request<T> {
  result: T
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}
interface Database {
  close(): void
  transaction(
    names: string[],
    mode: 'readwrite',
  ): {
    error: unknown
    oncomplete: (() => void) | null
    onabort: (() => void) | null
    objectStore(name: string): {
      getAll(): Request<unknown[]>
      put(value: unknown): unknown
    }
  }
}
declare const indexedDB: { open(name: string): Request<Database> }

test('Files launches from Dock, reads durable files, and keeps navigation through Refresh', async ({
  page,
}) => {
  await page.goto('/')
  const dock = page.getByRole('navigation', { name: 'Running applications' })
  await dock.getByRole('button', { name: 'Files', exact: true }).click()
  const frame = page.getByRole('region', { name: 'Files window' })
  const documents = frame.getByRole('button', { name: 'Open folder Documents' })
  await documents.focus()
  await page.keyboard.press('Enter')
  await expect(frame.getByRole('heading', { name: 'Documents' })).toBeFocused()
  await expect(frame.getByText('This folder is empty.')).toBeVisible()
  await page.evaluate(async () => {
    const request = indexedDB.open('browser-os')
    const database = await new Promise<Database>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = database.transaction(['nodes', 'contents', 'meta'], 'readwrite')
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
    const query = tx.objectStore('nodes').getAll()
    const raw = await new Promise<unknown[]>((resolve) => {
      query.onsuccess = () => resolve(query.result)
    })
    const nodes = raw as {
      id: string
      name: string
      metadataRevision: number
    }[]
    const documents = nodes.find((node) => node.name === 'Documents')!
    const now = Date.now()
    tx.objectStore('nodes').put({
      ...documents,
      metadataRevision: documents.metadataRevision + 1,
      updatedAt: now,
    })
    tx.objectStore('nodes').put({
      id: 'files-test',
      name: 'hello.txt',
      kind: 'file',
      parentId: documents.id,
      contentId: 'files-text',
      byteLength: 5,
      mime: 'text/plain',
      contentRevision: 1,
      metadataRevision: 1,
      metadata: { protected: false },
      createdAt: now,
      updatedAt: now,
    })
    tx.objectStore('contents').put({
      id: 'files-text',
      content: { kind: 'text', encoding: 'utf-8', text: 'hello' },
    })
    tx.objectStore('meta').put({ key: 'totals', nodeCount: 7, textBytes: 5 })
    await done
    database.close()
  })
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  const file = frame.getByRole('button', { name: 'Select file hello.txt' })
  await expect(file).toBeVisible()
  await expect(frame.getByRole('heading', { name: 'Documents' })).toBeVisible()
  await file.click()
  await expect(file).toHaveAttribute('aria-pressed', 'true')
  await expect(frame.getByText(/File opening will be available/)).toBeVisible()
  await page.reload()
  await dock.getByRole('button', { name: 'Files', exact: true }).click()
  await frame.getByRole('button', { name: 'Open folder Documents' }).click()
  await expect(
    frame.getByRole('button', { name: 'Select file hello.txt' }),
  ).toBeVisible()
})

test('two Files windows have separate cwd; Dock focuses an existing instance', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const frames = page.getByRole('region', { name: 'Files window' })
  await frames
    .first()
    .getByRole('button', { name: 'Open folder Documents' })
    .click()
  await expect(frames.first().getByText('This folder is empty.')).toBeVisible()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  await expect(frames).toHaveCount(2)
  await expect(
    frames.nth(1).getByRole('button', { name: 'Open folder Documents' }),
  ).toBeVisible()
  await expect(
    frames.first().getByRole('heading', { name: 'Documents' }),
  ).toBeVisible()
  await frames
    .nth(1)
    .getByRole('button', { name: 'Minimize Files', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'Files', exact: true })
    .click()
  await expect(frames).toHaveCount(2)
  // Repeated Dock activation cycles to the minimized instance without creating a process.
  await expect(
    frames.first().getByRole('heading', { name: 'Documents' }),
  ).toBeVisible()
})

test('folder controls and breadcrumbs remain reachable on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const frame = page.getByRole('region', { name: 'Files window' })
  await frame.getByRole('button', { name: 'Open folder Documents' }).click()
  await expect(
    frame.getByRole('button', { name: 'Up', exact: true }),
  ).toBeInViewport()
  await frame.getByRole('button', { name: 'Up', exact: true }).click()
  await expect(
    frame.getByRole('button', { name: 'Open folder Desktop' }),
  ).toBeVisible()
  await expect(
    frame.getByRole('button', { name: 'Close Files', exact: true }),
  ).toBeInViewport()
})
