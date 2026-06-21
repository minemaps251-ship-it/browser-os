import { expect, test } from '@playwright/test'
import type {} from './fixtures/harness'
let name: string
test.beforeEach(async ({ page }, testInfo) => {
  name = `idb-spike-${testInfo.testId}-${Date.now()}`
  await page.goto('/e2e/persistence/fixtures/indexeddb.html')
  await page.waitForFunction(() => Boolean(window.idbSpike))
})
test.afterEach(async ({ page }) => {
  await page.evaluate((name) => window.idbSpike.delete(name), name)
})
test('initializes schema/indexes/seed atomically and reopens without reseeding', async ({
  page,
}) => {
  const first = await page.evaluate((name) => window.idbSpike.seed(name), name)
  const second = await page.evaluate((name) => window.idbSpike.seed(name), name)
  expect(second).toEqual(first)
  expect(first.version).toBe(1)
  expect(first.stores).toEqual(['contents', 'meta', 'nodes', 'settings'])
  expect(first.indexes).toEqual(['byParent', 'bySibling'])
  expect(first.records[0]).toHaveLength(6)
  expect(first.records[1]).toEqual([])
  expect(first.records[2]).toEqual(
    expect.arrayContaining([
      { key: 'schema', version: 1 },
      { key: 'totals', nodeCount: 6, textBytes: 0 },
    ]),
  )
  expect(first.records[3]).toEqual([
    { key: 'theme', value: 'system', schemaVersion: 1 },
  ])
})
test('keeps committed data across a page reload', async ({ page }) => {
  await page.evaluate((name) => window.idbSpike.marker(name, true), name)
  await page.reload()
  await page.waitForFunction(() => Boolean(window.idbSpike))
  expect(
    await page.evaluate((name) => window.idbSpike.marker(name, false), name),
  ).toEqual({ key: 'marker', value: 'reload survives' })
})
test('request success does not imply commit and explicit abort rolls back all stores', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbSpike.requestThenAbort(name),
    name,
  )
  expect(result.order).toEqual(['request success', 'transaction abort'])
  expect(result.outcome).toBe('AbortError')
  expect(result.after).toEqual(result.before)
})
test('a sibling constraint error rolls back metadata and content together', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbSpike.constraintAbort(name),
    name,
  )
  expect(result.outcome).toBe('ConstraintError')
  expect(result.after).toEqual(result.before)
})
test('does not keep a transaction active across an unrelated task', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbSpike.inactive(name),
    name,
  )
  expect(result.errorName).toBe('TransactionInactiveError')
})
test('concurrent initial openings observe exactly one complete seed', async ({
  page,
}) => {
  const [first, second] = await page.evaluate(
    (name) => window.idbSpike.concurrent(name),
    name,
  )
  expect(first).toEqual(second)
  expect(first.records[0]).toHaveLength(6)
})
test('versionchange closes the managed connection even when its callback throws', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbSpike.versionChange(name),
    name,
  )
  expect(result.closed).toBe(true)
  expect(result.notifications).toEqual([2])
  expect(result.reopening).toMatchObject({
    ok: false,
    error: { code: 'NEWER_DATABASE' },
  })
})
test('a held raw connection blocks an upgrade until it closes', async ({
  page,
}) => {
  expect(
    await page.evaluate((name) => window.idbSpike.blocked(name), name),
  ).toEqual(['blocked', 'opened'])
})
test('rejects a newer database without deleting its existing data', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbSpike.newer(name),
    name,
  )
  expect(result.result).toMatchObject({
    ok: false,
    error: { code: 'NEWER_DATABASE' },
  })
  expect(result.version).toBe(2)
  expect(result.marker).toBe('keep')
})
test('rejects an incompatible v1 schema without repairing or wiping it', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbSpike.corrupt(name),
    name,
  )
  expect(result.result).toMatchObject({
    ok: false,
    error: { code: 'CORRUPT_SCHEMA' },
  })
  expect(result.stores).toEqual(['wrong'])
})
test('an initialization error aborts the schema and permits a fresh retry', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbSpike.failedSeed(name),
    name,
  )
  expect(result.result).toMatchObject({
    ok: false,
    error: { code: 'OPEN_FAILED' },
  })
  expect(result.snapshot.records[0]).toHaveLength(6)
})
test('an abandoned blocked opening aborts its late upgrade and leaks no connection', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbSpike.abandoned(name),
    name,
  )
  expect(result.result).toMatchObject({ ok: false, error: { code: 'BLOCKED' } })
  expect(result.version).toBe(1)
  expect(result.snapshot.records[0]).toHaveLength(6)
})

test('a timed-out opening closes its late successful connection', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbSpike.timeout(name),
    name,
  )
  expect(result.result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
  expect(result.version).toBe(2)
})

test('isolates a rejected asynchronous versionchange callback', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  const result = await page.evaluate(
    (name) => window.idbSpike.versionChange(name, true),
    name,
  )
  expect(result.closed).toBe(true)
  expect(result.notifications).toEqual([2])
  expect(errors).toEqual([])
})
