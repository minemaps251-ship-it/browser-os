import { expect, test } from '@playwright/test'
import type { RelocateFailure } from './fixtures/relocateHarness'
import type {} from './fixtures/harness'
let name: string, errors: string[]
test.beforeEach(async ({ page }, info) => {
  name = `idb-spike-relocate-${info.testId}-${Date.now()}`
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/persistence/fixtures/indexeddb.html')
  await page.waitForFunction(() => Boolean(window.idbRelocate))
})
test.afterEach(async ({ page }) => {
  await page.evaluate((name) => window.idbSpike.delete(name), name)
  expect(errors).toEqual([])
})
test('matches memory folder rename/move, descendant invalidations and save-after-move; persists reload', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbRelocate.parity(name),
    name,
  )
  expect(result.actual).toEqual(result.expected)
  expect(result.audit.ok).toBe(true)
  expect(result.actual.path).toEqual({
    ok: true,
    value: '/B/Café/nested/note.txt',
  })
  expect(result.actual.events).toHaveLength(3)
  expect(result.actual.relocatedDocument).toEqual({
    ok: true,
    value: result.actual.original,
  })
  expect(result.actual.events[0].directoryIds).toEqual([result.actual.a])
  expect(result.actual.events[1].directoryIds).toEqual([
    result.actual.a,
    result.actual.b,
  ])
  expect(result.actual.events[0].contentIds).toEqual([])
  expect(result.actual.events[1].contentIds).toEqual([])
  expect(result.actual.events[1].pathIds).toEqual(
    [result.actual.folder, result.actual.nested, result.actual.file].sort(),
  )
  expect(result.actual.original.node.contentId).toBe(
    result.actual.document.ok
      ? result.actual.document.value.node.contentId
      : undefined,
  )
  await page.reload()
  await page.waitForFunction(() => Boolean(window.idbRelocate))
  expect(
    await page.evaluate(
      ({ name, file }) => window.idbRelocate.paths(name, file),
      { name, file: result.actual.file },
    ),
  ).toEqual({ path: result.actual.path, document: result.actual.document })
})
test('NFC equivalent rename and same destination move are no-ops without factories/events/writes', async ({
  page,
}) => {
  expect(
    await page.evaluate((name) => window.idbRelocate.noop(name), name),
  ).toMatchObject({
    rename: { ok: true },
    move: { ok: true },
    calls: 0,
    events: [],
    unchanged: true,
  })
})
const cases: Record<RelocateFailure, string> = {
  missing: 'NOT_FOUND',
  root: 'PROTECTED',
  protected: 'PROTECTED',
  'source-system': 'PROTECTED',
  'target-system': 'PROTECTED',
  'missing-target': 'NOT_FOUND',
  'file-target': 'NOT_DIRECTORY',
  'invalid-name': 'INVALID_NAME',
  duplicate: 'ALREADY_EXISTS',
  self: 'CYCLE',
  descendant: 'CYCLE',
  'node-overflow': 'CORRUPT_DATA',
  'parent-overflow': 'CORRUPT_DATA',
  'missing-parent': 'CORRUPT_DATA',
  'bad-descendant': 'CORRUPT_DATA',
  timestamp: 'CORRUPT_DATA',
  operation: 'CORRUPT_DATA',
  factory: 'STORAGE_UNAVAILABLE',
  abort: 'STORAGE_UNAVAILABLE',
  quota: 'QUOTA',
  closed: 'STORAGE_UNAVAILABLE',
}
for (const [mode, code] of Object.entries(cases))
  test(`rejects ${mode} and preserves all records`, async ({ page }) => {
    const result = await page.evaluate(
      ({ name, mode }) => window.idbRelocate.failure(name, mode),
      { name, mode: mode as RelocateFailure },
    )
    expect(result).toMatchObject({
      result: { ok: false, error: { code } },
      events: [],
      unchanged: true,
    })
  })
for (const kind of ['sibling', 'cycle', 'save'] as const)
  test(`revalidates concurrent ${kind} operations`, async ({ page }) => {
    const result = await page.evaluate(
      ({ name, kind }) => window.idbRelocate.race(name, kind),
      { name, kind },
    )
    expect(result.audit.ok).toBe(true)
    expect(result.results.filter((result) => result.ok)).toHaveLength(
      kind === 'save' ? 2 : 1,
    )
    expect(result.events).toHaveLength(kind === 'save' ? 2 : 1)
    if (kind !== 'save')
      expect(result.results.find((result) => !result.ok)).toMatchObject({
        error: { code: kind === 'cycle' ? 'CYCLE' : 'ALREADY_EXISTS' },
      })
    else {
      expect(result.path).toEqual({ ok: true, value: '/B/renamed' })
      expect(result.document).toMatchObject({
        ok: true,
        value: {
          contentRevision: 2,
          content: { text: 'saved' },
          node: { metadataRevision: 3 },
        },
      })
    }
  })
test('delivers committed paths to another connection despite a throwing subscriber', async ({
  page,
}) => {
  expect(
    await page.evaluate((name) => window.idbRelocate.committed(name), name),
  ).toMatchObject({
    result: { ok: true },
    errors: 1,
    reads: [{ ok: true, value: '/new' }],
    audit: { ok: true },
  })
})
