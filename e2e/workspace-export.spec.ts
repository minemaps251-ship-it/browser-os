import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type Locator } from '@playwright/test'
import type { WorkspaceExport } from '../src/core/export/types.js'
async function download(
  page: Page,
  settings: Locator,
): Promise<WorkspaceExport> {
  const event = page.waitForEvent('download')
  await settings
    .getByRole('link', { name: 'Download JSON', exact: true })
    .click()
  const file = await event
  expect(file.suggestedFilename()).toMatch(/^browser-os-[\dTZ-]+\.json$/)
  const path = await file.path()
  if (!path) throw new Error('Download missing')
  return JSON.parse(await readFile(path, 'utf-8')) as WorkspaceExport
}
async function prepare(settings: Locator) {
  await settings
    .getByRole('button', { name: 'Prepare export', exact: true })
    .click()
  await expect(
    settings.getByRole('status').filter({ hasText: /^Export ready:/ }),
  ).toBeVisible()
}
test('download contains saved tree/settings, excludes drafts and stays an immutable copy until re-prepared', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'New file', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'New file' })
  await create.getByRole('textbox', { name: 'Name' }).fill('backup.txt')
  await create.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(create).toBeHidden()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Notes window' })
  const text = notes.getByRole('textbox', { name: 'Text' })
  const saved = 'Привет 日本語 🌍\n<script>literal()</script>'
  await text.fill(saved)
  await notes.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    notes.getByRole('status').filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await text.fill('unsaved newer draft')
  await notes
    .getByRole('button', { name: 'Minimize Notes', exact: true })
    .click()
  await files.getByRole('button', { name: 'New folder', exact: true }).click()
  const folder = page.getByRole('dialog', { name: 'New folder' })
  await folder.getByRole('textbox', { name: 'Name' }).fill('empty-export')
  await folder.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(folder).toBeHidden()
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Settings window' })
  await settings.getByRole('radio', { name: 'Dark', exact: true }).click()
  await expect(
    settings.getByRole('radio', { name: 'Dark', exact: true }),
  ).toBeChecked()
  await prepare(settings)
  const copy = await download(page, settings)
  expect(copy).toMatchObject({
    format: 'browser-os-workspace',
    version: 1,
    source: 'persistent',
    settings: { theme: 'dark' },
  })
  expect(
    copy.entries.find((entry) => entry.name === 'backup.txt'),
  ).toMatchObject({ kind: 'file', encoding: 'utf-8', text: saved })
  expect(
    copy.entries.find((entry) => entry.name === 'empty-export'),
  ).toMatchObject({ kind: 'directory' })
  expect(JSON.stringify(copy)).not.toContain('unsaved newer draft')
  const url = await settings
    .getByRole('link', { name: 'Download JSON' })
    .getAttribute('href')
  await settings
    .getByRole('button', { name: 'Minimize Settings', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Notes (minimized)', exact: true })
    .click()
  await notes.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    notes.getByRole('status').filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await notes
    .getByRole('button', { name: 'Minimize Notes', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Settings (minimized)', exact: true })
    .click()
  expect(
    await settings
      .getByRole('link', { name: 'Download JSON' })
      .getAttribute('href'),
  ).toBe(url)
  expect(await download(page, settings)).toEqual(copy)
  await prepare(settings)
  expect(
    await settings
      .getByRole('link', { name: 'Download JSON' })
      .getAttribute('href'),
  ).not.toBe(url)
  const updated = await download(page, settings)
  expect(
    updated.entries.find((entry) => entry.name === 'backup.txt'),
  ).toMatchObject({ text: 'unsaved newer draft' })
  await page.reload()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  await files
    .getByRole('button', { name: 'Select file backup.txt', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(text).toHaveValue('unsaved newer draft')
})
test('temporary workspace can be exported with keyboard on a narrow viewport', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('Denied', 'SecurityError')
      },
    })
  })
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Use a temporary workspace', exact: true })
    .click()
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Settings window' })
  const button = settings.getByRole('button', {
    name: 'Prepare export',
    exact: true,
  })
  await button.focus()
  await expect(button).toBeInViewport()
  await button.press('Enter')
  const link = settings.getByRole('link', {
    name: 'Download JSON',
    exact: true,
  })
  await expect(link).toBeVisible()
  await link.focus()
  await expect(link).toBeInViewport()
  const event = page.waitForEvent('download')
  await link.press('Enter')
  const file = await event,
    path = await file.path()
  if (!path) throw new Error('Download missing')
  const copy = JSON.parse(await readFile(path, 'utf-8')) as WorkspaceExport
  expect(copy.source).toBe('temporary')
  expect(
    copy.entries.some(
      (entry) => entry.parentId === null && entry.kind === 'directory',
    ),
  ).toBe(true)
  expect(copy.settings.theme).toBe('system')
})
test('a download allocation failure is recoverable without changing files or losing keyboard focus', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL)
    let failed = false
    URL.createObjectURL = (blob) => {
      if (!failed) {
        failed = true
        throw new Error('Injected allocation failure')
      }
      return original(blob)
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Settings window' })
  const button = settings.getByRole('button', {
    name: 'Prepare export',
    exact: true,
  })
  await button.focus()
  await button.press('Enter')
  await expect(settings.getByRole('alert')).toContainText(
    'could not prepare this download',
  )
  await expect(button).toBeFocused()
  await expect(
    settings.getByRole('link', { name: 'Download JSON' }),
  ).toHaveCount(0)
  await button.press('Enter')
  await expect(
    settings.getByRole('link', { name: 'Download JSON' }),
  ).toBeVisible()
  const copy = await download(page, settings)
  expect(copy.entries.filter((entry) => entry.kind === 'file')).toHaveLength(0)
})
