import { expect, test } from '@playwright/test'
import { vfsContractCases } from '../../src/test/vfs/scenarios'
import type {} from './fixtures/contractHarness'
import type {} from './fixtures/harness'
let name: string, errors: string[]
test.beforeEach(async ({ page }, info) => {
  name = `idb-spike-contract-${info.testId}-${Date.now()}`
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/persistence/fixtures/indexeddb.html')
  await page.waitForFunction(() => Boolean(window.idbContract))
})
test.afterEach(async ({ page }) => {
  await page.evaluate((name) => window.idbSpike.delete(name), name)
  expect(errors).toEqual([])
})
for (const scenario of vfsContractCases)
  test(`IndexedDB shared contract: ${scenario.name}`, async ({ page }) => {
    test.setTimeout(60000)
    const result = await page.evaluate(
      ({ name, scenario }) => window.idbContract.run(name, scenario),
      { name, scenario: scenario.name },
    )
    expect(result.checks).toBeGreaterThan(0)
    if (scenario.name.includes('generated')) {
      expect(result.checks).toBeGreaterThanOrEqual(49)
      expect(result.reopens).toBeGreaterThan(0)
    }
    await page.reload()
    await page.waitForFunction(() => Boolean(window.idbContract))
    expect(
      await page.evaluate((name) => window.idbContract.afterReload(name), name),
    ).toEqual(result.snapshot)
  })
