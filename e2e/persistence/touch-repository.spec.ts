import { expect, test } from '@playwright/test'
import type {} from './fixtures/touchHarness'
import type {} from './fixtures/harness'
for (const mode of ['abort', 'quota', 'closed'] as const)
  test(`touch rolls back ${mode} without content changes or events`, async ({
    page,
  }, info) => {
    const name = `idb-spike-touch-${info.testId}-${Date.now()}`
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/e2e/persistence/fixtures/indexeddb.html')
    await page.waitForFunction(() => Boolean(window.idbTouch))
    try {
      const result = await page.evaluate(
        ({ name, mode }) => window.idbTouch.failure(name, mode),
        { name, mode },
      )
      expect(result.result).toMatchObject({
        ok: false,
        error: { code: mode === 'quota' ? 'QUOTA' : 'STORAGE_UNAVAILABLE' },
      })
      expect(result.unchanged).toBe(true)
      expect(result.events).toHaveLength(0)
      expect(errors).toEqual([])
    } finally {
      await page.evaluate((name) => window.idbSpike.delete(name), name)
    }
  })
