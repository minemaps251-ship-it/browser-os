import { expect, test } from '@playwright/test'
import type { RemoveFailure } from './fixtures/removeHarness'
import type {} from './fixtures/harness'
let name: string, errors: string[]
test.beforeEach(async ({ page }, info) => {
  name = `idb-spike-remove-${info.testId}-${Date.now()}`
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/persistence/fixtures/indexeddb.html')
  await page.waitForFunction(() => Boolean(window.idbRemove))
})
test.afterEach(async ({ page }) => {
  await page.evaluate((name) => window.idbSpike.delete(name), name)
  expect(errors).toEqual([])
})
test('matches memory recursive/file/empty deletion, revisions/events/counters; persists reload', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbRemove.parity(name),
    name,
  )
  expect(result.actual).toEqual(result.expected)
  expect(result.audit.ok).toBe(true)
  expect(result.actual.events).toHaveLength(3)
  expect(result.actual.events[0]).toMatchObject({
    metadataIds: ['vfs-root'],
    directoryIds: ['vfs-root'],
    removedIds: [
      result.actual.folder,
      result.actual.nested,
      result.actual.file,
    ].sort(),
    contentIds: [],
    pathIds: [],
  })
  expect(result.snapshot[0]).toHaveLength(6)
  expect(result.snapshot[1]).toEqual([])
  expect(result.snapshot[2]).toContainEqual({
    key: 'totals',
    nodeCount: 6,
    textBytes: 0,
  })
  await page.reload()
  await page.waitForFunction(() => Boolean(window.idbRemove))
  const reopened = await page.evaluate(
    ({ name, id }) => window.idbRemove.read(name, id),
    { name, id: result.actual.folder },
  )
  expect(reopened.node).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
  expect(reopened.snapshot).toEqual(result.snapshot)
})
const failures: Record<RemoveFailure, string> = {
  missing: 'NOT_FOUND',
  root: 'PROTECTED',
  system: 'PROTECTED',
  'system-child': 'PROTECTED',
  'protected-descendant': 'PROTECTED',
  'not-empty': 'NOT_EMPTY',
  'invalid-options': 'INVALID_REQUEST',
  'bad-descendant': 'CORRUPT_DATA',
  'bad-parent': 'CORRUPT_DATA',
  'shared-content': 'CORRUPT_DATA',
  counter: 'CORRUPT_DATA',
  underflow: 'CORRUPT_DATA',
  overflow: 'CORRUPT_DATA',
  factory: 'STORAGE_UNAVAILABLE',
  timestamp: 'CORRUPT_DATA',
  operation: 'CORRUPT_DATA',
  quota: 'QUOTA',
  abort: 'STORAGE_UNAVAILABLE',
  closed: 'STORAGE_UNAVAILABLE',
}
for (const [mode, code] of Object.entries(failures))
  test(`rejects ${mode} without mutation/events`, async ({ page }) => {
    expect(
      await page.evaluate(
        ({ name, mode }) => window.idbRemove.failure(name, mode),
        { name, mode: mode as RemoveFailure },
      ),
    ).toMatchObject({
      result: { ok: false, error: { code } },
      events: [],
      unchanged: true,
    })
  })
for (const competingFirst of [false, true])
  for (const kind of ['create', 'save', 'move', 'copy', 'remove'] as const)
    test(`serializes remove/${kind} (competing first: ${competingFirst}) without orphans`, async ({
      page,
    }) => {
      const result = await page.evaluate(
        ({ name, kind, competingFirst }) =>
          window.idbRemove.race(name, kind, competingFirst),
        { name, kind, competingFirst },
      )
      if (kind === 'remove')
        expect(result.results.filter((result) => result.ok)).toHaveLength(1)
      else expect(result.results[0].ok).toBe(true)
      expect(result.folder).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      })
      expect(result.audit.ok).toBe(true)
      const competing = result.results[1]
      if (!competing.ok) expect(competing.error.code).toBe('NOT_FOUND')
      if (kind === 'move' && competing.ok) expect(result.file.ok).toBe(true)
      else
        expect(result.file).toMatchObject({
          ok: false,
          error: { code: 'NOT_FOUND' },
        })
      expect(result.snapshot[1]).toHaveLength(
        (kind === 'move' || kind === 'copy') && competing.ok ? 1 : 0,
      )
    })
for (const corruption of ['bad-text', 'missing-text', 'none'] as const)
  test(`cleans ${corruption} contents, releases budgets and publishes only committed removal`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      ({ name, corruption }) => window.idbRemove.recovery(name, corruption),
      { name, corruption },
    )
    expect(result.result.ok).toBe(true)
    expect(result.after[0]).toHaveLength(6)
    expect(result.after[1]).toEqual([])
    expect(result.after[2]).toContainEqual({
      key: 'totals',
      nodeCount: 6,
      textBytes: 0,
    })
    expect(result.reads).toMatchObject([
      { ok: false, error: { code: 'NOT_FOUND' } },
    ])
    expect(result.errors).toBe(2)
    expect(result.recreated.ok).toBe(true)
    expect(result.audit.ok).toBe(true)
  })

test('removes a deep tree iteratively without leaving records', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbRemove.deep(name),
    name,
  )
  expect(result).toMatchObject({
    result: { ok: true },
    count: 400,
    audit: { ok: true },
  })
  expect(result.snapshot[0]).toHaveLength(6)
  expect(result.snapshot[1]).toEqual([])
})
