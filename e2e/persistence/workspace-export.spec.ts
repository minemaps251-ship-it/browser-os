import { expect, test } from '@playwright/test'
import type {} from './fixtures/exportHarness'
import type {} from './fixtures/harness'
import type { WorkspaceExport } from '../../src/core/export/types'
test('exports one committed tree/settings snapshot while another connection writes; reads never mutate storage', async ({
  page,
}, info) => {
  const name = `idb-spike-export-${info.testId}-${Date.now()}`
  await page.goto('/e2e/persistence/fixtures/indexeddb.html')
  await page.waitForFunction(() => Boolean(window.idbExport))
  try {
    const result = await page.evaluate(
      (name) => window.idbExport.consistent(name),
      name,
    )
    expect(result.before).toMatchObject({
      ok: true,
      value: { theme: 'system', contents: [{ content: { text: 'before' } }] },
    })
    if (!result.after.ok) throw new Error(result.after.error.message)
    const document = JSON.parse(result.after.value.json) as WorkspaceExport
    expect(document.settings.theme).toBe('dark')
    expect(
      document.entries.find((entry) => entry.kind === 'file'),
    ).toMatchObject({ text: 'after!' })
    expect(result.scopes).toEqual([
      { stores: ['contents', 'meta', 'nodes', 'settings'], mode: 'readonly' },
    ])
    expect(result.immutable).toBe(true)
    expect(result.events).toEqual([])
    expect(result.unchanged).toBe(true)
  } finally {
    await page.evaluate((name) => window.idbSpike.delete(name), name)
  }
})
for (const mode of [
  'orphan',
  'missing',
  'wrong-size',
  'theme',
  'totals',
  'abort',
  'closed',
] as const) {
  test(`export rejects ${mode} without repair, data loss or partial copy`, async ({
    page,
  }, info) => {
    const name = `idb-spike-export-${info.testId}-${Date.now()}`
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/e2e/persistence/fixtures/indexeddb.html')
    await page.waitForFunction(() => Boolean(window.idbExport))
    try {
      const result = await page.evaluate(
        ({ name, mode }) => window.idbExport.failure(name, mode),
        { name, mode },
      )
      expect(result.result).toMatchObject({
        ok: false,
        error: {
          code: ['abort', 'closed'].includes(mode)
            ? 'UNAVAILABLE'
            : 'INVALID_DATA',
        },
      })
      expect(result.unchanged).toBe(true)
      expect(errors).toEqual([])
    } finally {
      await page.evaluate((name) => window.idbSpike.delete(name), name)
    }
  })
}
