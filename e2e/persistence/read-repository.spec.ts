import { expect, test } from '@playwright/test'
import type { Corruption } from './fixtures/readHarness'
import type {} from './fixtures/harness'
let name: string
test.beforeEach(async ({ page }, testInfo) => {
  name = `idb-spike-read-${testInfo.testId}-${Date.now()}`
  await page.goto('/e2e/persistence/fixtures/indexeddb.html')
  await page.waitForFunction(() => Boolean(window.idbRead))
})
test.afterEach(async ({ page }) => {
  await page.evaluate((name) => window.idbSpike.delete(name), name)
})
test('matches memory read semantics for paths, metadata, text, ordering and errors', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbRead.parity(name),
    name,
  )
  expect(result.actual).toEqual(result.expected)
  expect(result.audit.ok).toBe(true)
})
test('reads the same VFS document after reopening and page reload', async ({
  page,
}) => {
  const first = await page.evaluate(
    (name) => window.idbRead.persist(name, true),
    name,
  )
  const reopened = await page.evaluate(
    (name) => window.idbRead.persist(name, false),
    name,
  )
  expect(reopened).toEqual(first)
  await page.reload()
  await page.waitForFunction(() => Boolean(window.idbRead))
  expect(
    await page.evaluate((name) => window.idbRead.persist(name, false), name),
  ).toEqual(first)
  expect(first.document).toMatchObject({
    ok: true,
    value: { content: { text: 'Привет 🌍' }, contentRevision: 2 },
  })
})
for (const corruption of [
  'missing-parent',
  'file-parent',
  'cycle',
  'missing-root',
  'bad-root',
  'bad-name',
  'bad-revision',
] satisfies Corruption[]) {
  test(`rejects damaged metadata: ${corruption}, without changing stored records`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      ({ name, corruption }) => window.idbRead.corrupt(name, corruption),
      { name, corruption },
    )
    for (const failure of [
      result.document,
      result.stat,
      result.path,
      result.audit,
    ])
      expect(failure).toMatchObject({
        ok: false,
        error: { code: 'CORRUPT_DATA' },
      })
    expect(result.unchanged).toBe(true)
  })
}
for (const corruption of [
  'missing-content',
  'bad-unicode',
  'byte-mismatch',
] satisfies Corruption[]) {
  test(`isolates file-local content damage: ${corruption}`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      ({ name, corruption }) => window.idbRead.corrupt(name, corruption),
      { name, corruption },
    )
    expect(result.document).toMatchObject({
      ok: false,
      error: { code: 'CORRUPT_DATA', nodeId: 'read-file' },
    })
    expect(result.listing.ok).toBe(true)
    expect(result.stat.ok).toBe(true)
    expect(result.healthy).toMatchObject({
      ok: true,
      value: { content: { text: 'healthy' } },
    })
    expect(result.audit.ok).toBe(true) // Metadata audit deliberately does not load texts.
    expect(result.unchanged).toBe(true)
  })
}
for (const corruption of [
  'wrong-counter',
  'shared-content',
] satisfies Corruption[]) {
  test(`full metadata audit rejects ${corruption}`, async ({ page }) => {
    const result = await page.evaluate(
      ({ name, corruption }) => window.idbRead.corrupt(name, corruption),
      { name, corruption },
    )
    expect(result.audit).toMatchObject({
      ok: false,
      error: { code: 'CORRUPT_DATA' },
    })
    expect(result.unchanged).toBe(true)
  })
}
test('returns typed storage errors for a closed connection', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbRead.closed(name),
    name,
  )
  expect(result.node).toMatchObject({
    ok: false,
    error: { code: 'STORAGE_UNAVAILABLE' },
  })
  expect(result.audit).toMatchObject({
    ok: false,
    error: { code: 'STORAGE_UNAVAILABLE' },
  })
})
test('reads coherent document metadata and text while another connection commits', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbRead.coherent(name),
    name,
  )
  expect(result.raced.ok).toBe(true)
  if (!result.raced.ok) throw new Error('read failed')
  const document = result.raced.value
  expect(document.content.text).toBe(
    document.contentRevision === 2 ? 'Привет 🌍' : 'new committed text',
  )
  expect(new TextEncoder().encode(document.content.text).byteLength).toBe(
    document.node.byteLength,
  )
  expect(result.after).toMatchObject({
    ok: true,
    value: { content: { text: 'new committed text' }, contentRevision: 3 },
  })
  expect(result.oldSnapshot.content.text).toBe('Привет 🌍')
  expect(result.audit.ok).toBe(true)
})
