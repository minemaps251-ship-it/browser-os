import { expect, test } from '@playwright/test'
import type { CopyFailure } from './fixtures/copyHarness'
import type {} from './fixtures/harness'
let name: string, errors: string[]
test.beforeEach(async ({ page }, info) => {
  name = `idb-spike-copy-${info.testId}-${Date.now()}`
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/persistence/fixtures/indexeddb.html')
  await page.waitForFunction(() => Boolean(window.idbCopy))
})
test.afterEach(async ({ page }) => {
  await page.evaluate((name) => window.idbSpike.delete(name), name)
  expect(errors).toEqual([])
})
test('matches memory copy semantics, independent content IDs/revisions and reload persistence', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbCopy.parity(name),
    name,
  )
  expect(result.actual).toEqual(result.expected)
  const actual = result.actual
  expect(actual.sourceAfterCopy).toEqual({ ok: true, value: actual.original })
  expect(actual.copied.node.id).not.toBe(actual.original.node.id)
  expect(actual.copied.node.contentId).not.toBe(actual.original.node.contentId)
  expect(actual.copied).toMatchObject({
    contentRevision: 1,
    content: { text: 'Привет 🌍' },
    node: { metadataRevision: 1, byteLength: 17 },
  })
  expect(actual.duplicate).toMatchObject({ error: { code: 'ALREADY_EXISTS' } })
  expect(actual.sourceAfter).toMatchObject({
    ok: true,
    value: { content: { text: 'source changed' } },
  })
  expect(actual.copyAfter).toMatchObject({
    ok: true,
    value: { content: { text: 'copy changed' } },
  })
  expect(actual.secondCopy).toMatchObject({
    ok: true,
    value: { content: { text: 'Привет 🌍' }, contentRevision: 1 },
  })
  expect(actual.parent).toMatchObject({
    ok: true,
    value: { metadataRevision: 3 },
  })
  expect(actual.events[0]).toMatchObject({
    metadataIds: [actual.copy, actual.folder],
    contentIds: [actual.copy],
    pathIds: [actual.copy],
    directoryIds: [actual.folder],
    removedIds: [],
  })
  expect(result.audit.ok).toBe(true)
  await page.reload()
  await page.waitForFunction(() => Boolean(window.idbCopy))
  expect(
    await page.evaluate(({ name, id }) => window.idbCopy.read(name, id), {
      name,
      id: actual.copy,
    }),
  ).toEqual(actual.copyAfter)
})
test('copies protected/system source with MIME retained into an unprotected empty file; commits before events', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbCopy.protectedSource(name),
    name,
  )
  expect(result.document).toMatchObject({
    ok: true,
    value: {
      contentRevision: 1,
      content: { text: '' },
      node: {
        mime: 'application/json',
        byteLength: 0,
        metadata: { protected: false },
      },
    },
  })
  expect(result.source).toMatchObject({
    ok: true,
    value: { node: { metadata: { protected: true } } },
  })
  expect(result.events).toHaveLength(1)
  expect(result.errors).toBe(2)
  expect(result.reads).toEqual([result.document])
  expect(result.second.ok).toBe(true)
  expect(result.audit.ok).toBe(true)
})
const failures: Record<CopyFailure, string> = {
  'missing-source': 'NOT_FOUND',
  'directory-source': 'NOT_FILE',
  'missing-content': 'CORRUPT_DATA',
  'bad-content': 'CORRUPT_DATA',
  'bad-parent': 'CORRUPT_DATA',
  'missing-target': 'NOT_FOUND',
  'file-target': 'NOT_DIRECTORY',
  'system-target': 'PROTECTED',
  'invalid-name': 'INVALID_NAME',
  duplicate: 'ALREADY_EXISTS',
  'node-collision': 'CORRUPT_DATA',
  'content-collision': 'CORRUPT_DATA',
  factory: 'STORAGE_UNAVAILABLE',
  timestamp: 'CORRUPT_DATA',
  operation: 'CORRUPT_DATA',
  counter: 'CORRUPT_DATA',
  'parent-overflow': 'CORRUPT_DATA',
  quota: 'QUOTA',
  abort: 'STORAGE_UNAVAILABLE',
  closed: 'STORAGE_UNAVAILABLE',
}
for (const [mode, code] of Object.entries(failures))
  test(`rejects ${mode} without mutation/events`, async ({ page }) => {
    expect(
      await page.evaluate(
        ({ name, mode }) => window.idbCopy.failure(name, mode),
        { name, mode: mode as CopyFailure },
      ),
    ).toMatchObject({
      result: { ok: false, error: { code } },
      events: [],
      unchanged: true,
    })
  })
for (const kind of ['sibling', 'save', 'budget', 'nodes'] as const)
  test(`serializes concurrent copy/${kind} operations`, async ({ page }) => {
    const result = await page.evaluate(
      ({ name, kind }) => window.idbCopy.race(name, kind),
      { name, kind },
    )
    expect(result.audit.ok).toBe(true)
    expect(result.results.filter((result) => result.ok)).toHaveLength(
      kind === 'save' ? 2 : 1,
    )
    if (kind === 'save') {
      expect(result.source).toMatchObject({
        ok: true,
        value: { contentRevision: 2, content: { text: 'new é' } },
      })
      const copy = result.copies[0]
      expect(copy.ok).toBe(true)
      if (copy.ok) {
        expect(['old 🌍', 'new é']).toContain(copy.value.content.text)
        expect(copy.value.node.byteLength).toBe(
          new TextEncoder().encode(copy.value.content.text).byteLength,
        )
        expect(copy.value.contentRevision).toBe(1)
      }
    } else
      expect(result.results.find((result) => !result.ok)).toMatchObject({
        error: { code: kind === 'sibling' ? 'ALREADY_EXISTS' : 'TOO_LARGE' },
      })
  })

test('copies an exact maximum-size file in the same parent without overwriting source', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbCopy.boundary(name),
    name,
  )
  expect(result.duplicate).toMatchObject({
    ok: false,
    error: { code: 'ALREADY_EXISTS' },
  })
  expect(result.document).toMatchObject({
    ok: true,
    value: {
      contentRevision: 1,
      node: { name: 'maximum-copy', byteLength: 1048576 },
    },
  })
  expect(result.audit.ok).toBe(true)
})
