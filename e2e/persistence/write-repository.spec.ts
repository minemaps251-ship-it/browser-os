import { expect, test } from '@playwright/test'
import type { FailureMode } from './fixtures/writeHarness'
import type {} from './fixtures/harness'
let name: string, errors: string[]
test.beforeEach(async ({ page }, info) => {
  name = `idb-spike-write-${info.testId}-${Date.now()}`
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/persistence/fixtures/indexeddb.html')
  await page.waitForFunction(() => Boolean(window.idbWrite))
})
test.afterEach(async ({ page }) => {
  await page.evaluate((name) => window.idbSpike.delete(name), name)
  expect(errors).toEqual([])
})
test('saves grow/identical/empty/shrink snapshots, commits receipts/events and persists reload', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbWrite.saves(name),
    name,
  )
  expect(result.receipts.map((receipt) => receipt.contentRevision)).toEqual([
    2, 3, 4, 5,
  ])
  expect(result.events).toHaveLength(4)
  for (const [index, event] of result.events.entries())
    expect(event).toEqual({
      operationId: result.receipts[index].operationId,
      originRequestId: result.receipts[index].originRequestId,
      metadataIds: [result.file],
      contentIds: [result.file],
      directoryIds: ['vfs-root'],
      pathIds: [],
      removedIds: [],
    })
  expect(result.parentAfter).toEqual({ ok: true, value: result.parentBefore })
  expect(result.before).toMatchObject({
    contentRevision: 1,
    content: { text: 'old' },
  })
  expect(result.document).toMatchObject({
    ok: true,
    value: {
      contentRevision: 5,
      content: { text: 'é' },
      node: { byteLength: 2, metadataRevision: 5 },
    },
  })
  expect(result.observations).toHaveLength(4)
  expect(
    result.observations.every(
      (observation) => observation.ok && observation.value.contentRevision >= 2,
    ),
  ).toBe(true)
  expect(result.audit.ok).toBe(true)
  await page.reload()
  await page.waitForFunction(() => Boolean(window.idbWrite))
  expect(
    await page.evaluate(({ name, file }) => window.idbWrite.read(name, file), {
      name,
      file: result.file,
    }),
  ).toEqual(result.document)
})
test('only one connection can save a shared expected revision', async ({
  page,
}) => {
  const result = await page.evaluate((name) => window.idbWrite.race(name), name)
  expect(result.results.filter((result) => result.ok)).toHaveLength(1)
  expect(result.results.find((result) => !result.ok)).toMatchObject({
    error: { code: 'CONFLICT', expectedRevision: 1, actualRevision: 2 },
  })
  expect(result.events).toHaveLength(1)
  expect(result.document).toMatchObject({
    ok: true,
    value: {
      contentRevision: 2,
      content: {
        text:
          result.events[0].originRequestId === 'first'
            ? 'first 🌍'
            : 'second é',
      },
    },
  })
  expect(result.audit.ok).toBe(true)
})
const failures: Record<FailureMode, string> = {
  stale: 'CONFLICT',
  missing: 'NOT_FOUND',
  directory: 'NOT_FILE',
  protected: 'PROTECTED',
  system: 'PROTECTED',
  'invalid-options': 'INVALID_REQUEST',
  'invalid-text': 'INVALID_CONTENT',
  'file-limit': 'TOO_LARGE',
  'missing-content': 'CORRUPT_DATA',
  'bad-content': 'CORRUPT_DATA',
  counter: 'CORRUPT_DATA',
  parent: 'CORRUPT_DATA',
  overflow: 'CORRUPT_DATA',
  factory: 'STORAGE_UNAVAILABLE',
  timestamp: 'CORRUPT_DATA',
  operation: 'CORRUPT_DATA',
  abort: 'STORAGE_UNAVAILABLE',
  quota: 'QUOTA',
  closed: 'STORAGE_UNAVAILABLE',
}
for (const [mode, code] of Object.entries(failures))
  test(`rejects ${mode} without changes or events`, async ({ page }) => {
    const result = await page.evaluate(
      ({ name, mode }) => window.idbWrite.failure(name, mode),
      { name, mode: mode as FailureMode },
    )
    expect(result.result).toMatchObject({ ok: false, error: { code } })
    expect(result.unchanged).toBe(true)
    expect(result.events).toEqual([])
  })
test('serializes aggregate-byte races and releases bytes on shrink', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbWrite.budgetRace(name),
    name,
  )
  expect(result.results.filter((result) => result.ok)).toHaveLength(1)
  expect(result.results.find((result) => !result.ok)).toMatchObject({
    error: { code: 'TOO_LARGE' },
  })
  expect(result.freed.ok).toBe(true)
  expect(result.freedB.ok).toBe(true)
  expect(result.exact).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
  expect(result.audit.ok).toBe(true)
})
test('isolates listener failure and supports unsubscribe after a successful save', async ({
  page,
}) => {
  expect(
    await page.evaluate((name) => window.idbWrite.listener(name), name),
  ).toMatchObject({
    first: { ok: true },
    second: { ok: true },
    errors: 2,
    deliveries: 1,
    audit: { ok: true },
  })
})

test('accepts the exact file limit and rejects malformed save options without changes', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbWrite.boundaries(name),
    name,
  )
  expect(result.exact).toMatchObject({
    ok: true,
    value: { contentRevision: 2 },
  })
  expect(result.document).toMatchObject({
    ok: true,
    value: { node: { byteLength: 1048576 } },
  })
  for (const failure of result.invalid)
    expect(failure).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    })
  expect(result.unchanged).toBe(true)
  expect(result.audit.ok).toBe(true)
})
