import { expect, test } from '@playwright/test'
import type {} from './fixtures/refreshHarness'
let name: string
test.beforeEach(async ({ page }, info) => {
  name = `idb-refresh-${info.testId}-${Date.now()}`
  await page.goto('/e2e/persistence/fixtures/refresh.html')
  await page.waitForFunction(() => Boolean(window.refreshHarness))
})
test.afterEach(async ({ context, page }) => {
  for (const tab of context.pages()) {
    if (!tab.isClosed())
      await tab.evaluate(() => window.refreshHarness?.dispose())
  }
  await page.evaluate((name) => window.refreshHarness.delete(name), name)
})
test('refresh invalidates views and re-reads files and settings changed by another connection', async ({
  page,
  context,
}) => {
  await page.evaluate((name) => window.refreshHarness.open(name), name)
  const writer = await context.newPage()
  await writer.goto('/e2e/persistence/fixtures/refresh.html')
  await writer.waitForFunction(() => Boolean(window.refreshHarness))
  await writer.evaluate((name) => window.refreshHarness.open(name), name)
  const created = await writer.evaluate(() =>
    window.refreshHarness.createFile(),
  )
  expect(created.ok).toBe(true)
  if (!created.ok) throw new Error(created.error.message)
  await writer.evaluate(() => window.refreshHarness.setDark())
  const snapshot = await page.evaluate(() => window.refreshHarness.refresh())
  expect(snapshot.refresh).toMatchObject({ revision: 1, error: null })
  expect(snapshot.settings.theme).toBe('dark')
  expect(snapshot.children).toMatchObject({
    ok: true,
    value: expect.arrayContaining([
      expect.objectContaining({ id: created.value, name: 'shared.txt' }),
    ]),
  })
  expect(
    await page.evaluate((id) => window.refreshHarness.read(id), created.value),
  ).toMatchObject({
    ok: true,
    value: { content: { text: 'From another tab' } },
  })
  await writer.evaluate((id) => window.refreshHarness.remove(id), created.value)
  const afterRemove = await page.evaluate(() => window.refreshHarness.refresh())
  expect(afterRemove.refresh.revision).toBe(2)
  if (!afterRemove.children.ok)
    throw new Error(afterRemove.children.error.message)
  expect(
    afterRemove.children.value.some((node) => node.id === created.value),
  ).toBe(false)
})
test('a closed connection reports failure without announcing a successful refresh', async ({
  page,
}) => {
  await page.evaluate((name) => window.refreshHarness.open(name), name)
  await page.evaluate(() => window.refreshHarness.closeConnection())
  const snapshot = await page.evaluate(() => window.refreshHarness.refresh())
  expect(snapshot.refresh).toMatchObject({
    revision: 0,
    refreshing: false,
    error: expect.any(String),
  })
  expect(snapshot.settings.theme).toBe('system')
})
