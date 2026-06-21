import { expect, test } from '@playwright/test'
import type {} from './fixtures/createHarness'
import type {} from './fixtures/harness'
let name: string
let pageErrors: string[]
test.beforeEach(async ({ page }, info) => {
  pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  name = `idb-spike-create-${info.testId}-${Date.now()}`
  await page.goto('/e2e/persistence/fixtures/indexeddb.html')
  await page.waitForFunction(() => Boolean(window.idbCreate))
})
test.afterEach(async ({ page }) => {
  await page.evaluate((name) => window.idbSpike.delete(name), name)
  expect(pageErrors).toEqual([])
})
test('creates atomic documents with NFC, revisions, counters and committed events; survives reload', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbCreate.basics(name),
    name,
  )
  expect(result.audit.ok).toBe(true)
  expect(result.document).toMatchObject({
    ok: true,
    value: {
      content: { text: 'Привет 🌍' },
      contentRevision: 1,
      node: { name: 'Café.txt', byteLength: 17, metadataRevision: 1 },
    },
  })
  expect(result.empty).toMatchObject({
    ok: true,
    value: { node: { byteLength: 0 }, content: { text: '' } },
  })
  expect(result.parent).toMatchObject({
    ok: true,
    value: { metadataRevision: 3 },
  })
  expect(result.events).toHaveLength(3)
  expect(result.events[1]).toMatchObject({
    metadataIds: [result.file, result.folder],
    contentIds: [result.file],
    pathIds: [result.file],
    directoryIds: [result.folder],
    removedIds: [],
  })
  expect(
    result.events.every((event) => event.operationId === event.originRequestId),
  ).toBe(true)
  expect(result.observations.every((observation) => observation.ok)).toBe(true)
  for (const [key, code] of Object.entries({
    duplicate: 'ALREADY_EXISTS',
    protectedResult: 'PROTECTED',
    missing: 'NOT_FOUND',
    notDirectory: 'NOT_DIRECTORY',
    invalidName: 'INVALID_NAME',
    invalidContent: 'INVALID_CONTENT',
  }))
    expect(result[key as keyof typeof result]).toMatchObject({
      ok: false,
      error: { code },
    })
  await page.reload()
  await page.waitForFunction(() => Boolean(window.idbCreate))
  expect(
    await page.evaluate(({ name, file }) => window.idbCreate.read(name, file), {
      name,
      file: result.file,
    }),
  ).toEqual(result.document)
})
for (const sameName of [true, false])
  test(`serializes competing connections (same name: ${sameName})`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      ({ name, sameName }) => window.idbCreate.race(name, sameName),
      { name, sameName },
    )
    expect(result.results.filter((result) => result.ok)).toHaveLength(
      sameName ? 1 : 2,
    )
    if (sameName)
      expect(result.results.find((result) => !result.ok)).toMatchObject({
        error: { code: 'ALREADY_EXISTS' },
      })
    expect(result.parent).toMatchObject({
      ok: true,
      value: { metadataRevision: sameName ? 2 : 3 },
    })
    expect(result.audit.ok).toBe(true)
  })
for (const mode of [
  'abort',
  'node-collision',
  'content-collision',
  'factory',
  'counter',
  'closed',
  'quota',
] as const)
  test(`rolls back ${mode}, with no events or lost original content`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      ({ name, mode }) => window.idbCreate.rollback(name, mode),
      { name, mode },
    )
    expect(result.result).toMatchObject({
      ok: false,
      error: {
        code:
          mode === 'quota'
            ? 'QUOTA'
            : ['node-collision', 'content-collision', 'counter'].includes(mode)
              ? 'CORRUPT_DATA'
              : 'STORAGE_UNAVAILABLE',
      },
    })
    expect(result.unchanged).toBe(true)
    expect(result.events).toEqual([])
  })
for (const mode of ['file', 'total', 'nodes'] as const)
  test(`enforces ${mode} limit within competing transactions`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      ({ name, mode }) => window.idbCreate.limits(name, mode),
      { name, mode },
    )
    expect(result.results.filter((result) => result.ok)).toHaveLength(
      mode === 'file' ? 0 : 1,
    )
    expect(result.results.find((result) => !result.ok)).toMatchObject({
      error: { code: 'TOO_LARGE' },
    })
    expect(result.audit.ok).toBe(true)
  })
test('listener errors cannot fail a commit, and unsubscribe removes delivery', async ({
  page,
}) => {
  const result = await page.evaluate(
    (name) => window.idbCreate.listeners(name),
    name,
  )
  expect(result).toMatchObject({
    first: { ok: true },
    second: { ok: true },
    errors: 2,
    deliveries: 1,
    audit: { ok: true },
  })
})
