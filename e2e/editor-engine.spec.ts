/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import type {
  FileNode,
  StoredFileContent,
} from '../src/core/filesystem/types.js'
import type { TotalsRecord } from '../src/core/storage/types.js'

async function openEditor(page: Page) {
  await page
    .getByRole('button', { name: 'Open Code Editor', exact: true })
    .click()
  const editor = page.getByRole('region', { name: 'Code Editor window' })
  const code = editor.locator('.cm-content[contenteditable="true"]')
  await expect(code).toBeVisible()
  return { editor, code }
}
async function saveAs(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Save as' })
  await dialog.getByRole('textbox', { name: 'File name' }).fill(name)
  await dialog.getByRole('button', { name: 'Save file' }).click()
  await expect(dialog).toBeHidden()
}
// Fixture-only native reads verify raw persisted separators rather than normalized DOM text.
async function storedText(page: Page, name: string) {
  return page.evaluate(
    (name) =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('browser-os')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['nodes', 'contents'], 'readonly')
          tx.oncomplete = () => db.close()
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
          const nodes = tx.objectStore('nodes').getAll()
          nodes.onsuccess = () => {
            const node = (nodes.result as FileNode[]).find(
              (node) => node.name === name,
            )
            if (!node) {
              reject(new Error('Missing fixture file'))
              return
            }
            const request = tx.objectStore('contents').get(node.contentId)
            request.onsuccess = () =>
              resolve((request.result as StoredFileContent).content.text)
          }
        }
      }),
    name,
  )
}
async function seedText(page: Page, name: string, text: string) {
  // Seed a file created through Files, then reload; update all byte/revision invariants atomically.
  await page.evaluate(
    ({ name, text }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('browser-os')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['nodes', 'contents', 'meta'], 'readwrite')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
          const nodes = tx.objectStore('nodes').getAll()
          const totals = tx.objectStore('meta').get('totals')
          nodes.onsuccess = () => {
            const node = (nodes.result as FileNode[]).find(
              (node) => node.name === name,
            )
            if (!node) {
              tx.abort()
              return
            }
            const bytes = new TextEncoder().encode(text).byteLength
            tx.objectStore('nodes').put({
              ...node,
              byteLength: bytes,
              contentRevision: node.contentRevision + 1,
              metadataRevision: node.metadataRevision + 1,
            })
            tx.objectStore('contents').put({
              id: node.contentId,
              content: { kind: 'text', encoding: 'utf-8', text },
            })
            totals.onsuccess = () => {
              const record = totals.result as TotalsRecord
              tx.objectStore('meta').put({
                ...record,
                textBytes: record.textBytes + bytes - node.byteLength,
              })
            }
          }
        }
      }),
    { name, text },
  )
}
async function createFile(page: Page, name: string) {
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'New file' }).click()
  const dialog = page.getByRole('dialog', { name: 'New file' })
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
  return files
}
async function reopenFile(page: Page, name: string) {
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files
    .getByRole('button', { name: `Select file ${name}`, exact: true })
    .click()
  await files.getByRole('button', { name: 'Open in Code Editor' }).click()
  const closeFiles = files.getByRole('button', {
    name: 'Close Files',
    exact: true,
  })
  await closeFiles.focus()
  await closeFiles.press('Enter')
  await expect(files).toHaveCount(0)
  return {
    files,
    editor: page.getByRole('region', { name: 'Code Editor window' }),
  }
}
test('history and selection survive tab switches, save, theme and rename; Tab escapes the editor', async ({
  page,
}) => {
  await page.goto('/')
  const { editor, code } = await openEditor(page)
  const baseline = 'const answer: number = 42;'
  await code.fill(baseline)
  await code.press('Control+s')
  await saveAs(page, 'one.ts')
  await expect(editor).toContainText('typescript')
  await expect(code.locator('.cm-line span').first()).toBeVisible()
  await code.press('ControlOrMeta+End')
  await page.keyboard.type(' // draft')
  await code.press('ControlOrMeta+Home')
  await code.press('Shift+ArrowRight')
  await code.press('Shift+ArrowRight')
  await code.press('Shift+ArrowRight')
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await editor
    .getByRole('button', { name: 'Minimize Code Editor', exact: true })
    .click()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files
    .getByRole('button', { name: 'Select file one.ts', exact: true })
    .click()
  await files.getByRole('button', { name: 'Rename', exact: true }).click()
  await files.getByRole('textbox', { name: 'Rename one.ts' }).fill('renamed.js')
  await page.keyboard.press('Enter')
  await files
    .getByRole('button', { name: 'Minimize Files', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Code Editor (minimized)', exact: true })
    .click()
  await expect(editor).toContainText('javascript')
  await editor.getByRole('button', { name: 'New tab', exact: true }).click()
  await code.fill('independent second draft')
  await editor
    .getByRole('tab', { name: 'renamed.js, unsaved changes', exact: true })
    .click()
  await code.focus()
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('con')
  await code.press('ControlOrMeta+z')
  await expect(code).toHaveText(baseline)
  await expect(
    editor.getByRole('tab', { name: 'renamed.js', exact: true }),
  ).toBeVisible()
  await code.press('ControlOrMeta+Shift+z')
  await expect(code).toHaveText(baseline + ' // draft')
  await code.press('ControlOrMeta+f')
  const find = editor.getByRole('textbox', { name: 'Find', exact: true })
  await expect(find).toBeFocused()
  await find.fill('')
  await find.pressSequentially('answer')
  await expect(code.locator('.cm-searchMatch')).toHaveCount(1)
  await find.press('Escape')
  await expect(find).toHaveCount(0)
  await expect(code).toBeFocused()
  await code.press('Tab')
  await expect(code).not.toBeFocused()
  await editor
    .getByRole('tab', { name: 'Untitled, unsaved changes', exact: true })
    .click()
  await expect(code).toHaveText('independent second draft')
})
test('CRLF editing preserves raw storage and reload; mixed endings require explicit conversion', async ({
  page,
}) => {
  await page.goto('/')
  await createFile(page, 'windows.ts')
  await seedText(page, 'windows.ts', 'const first = 1;\r\nconst second = 2;')
  await page.reload()
  const { editor } = await reopenFile(page, 'windows.ts')
  const code = editor.locator('.cm-content[contenteditable="true"]')
  await expect(code).toBeVisible()
  await expect(editor).toContainText('CRLF')
  await code.press('ControlOrMeta+End')
  await code.press('Enter')
  await page.keyboard.type('// 日本語')
  await code.dispatchEvent('keydown', {
    key: 's',
    ctrlKey: true,
    isComposing: true,
    bubbles: true,
  })
  expect(await storedText(page, 'windows.ts')).toBe(
    'const first = 1;\r\nconst second = 2;',
  )
  await code.press('Control+s')
  const expected = 'const first = 1;\r\nconst second = 2;\r\n// 日本語'
  await expect.poll(() => storedText(page, 'windows.ts')).toBe(expected)
  await page.reload()
  await reopenFile(page, 'windows.ts')
  await expect(code.locator('.cm-line')).toHaveText(expected.split('\r\n'))
  await editor
    .getByRole('button', { name: 'Close Code Editor', exact: true })
    .click()
  await createFile(page, 'mixed.txt')
  await seedText(page, 'mixed.txt', 'one\r\ntwo\nthree')
  await page.reload()
  await reopenFile(page, 'mixed.txt')
  await expect(editor.getByRole('textbox', { name: 'Code' })).toHaveAttribute(
    'readonly',
    '',
  )
  const mixed = editor.getByRole('textbox', { name: 'Code' })
  expect(
    await mixed.evaluate((input) =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    ),
  ).toBe(false)
  expect(await storedText(page, 'mixed.txt')).toBe('one\r\ntwo\nthree')
  await editor
    .getByRole('button', { name: 'Convert line endings to LF' })
    .click()
  await expect(code).toBeVisible()
  await code.press('Control+s')
  await expect.poll(() => storedText(page, 'mixed.txt')).toBe('one\ntwo\nthree')
})
test('engine remains lazy on desktop and Notes; chunk failure keeps editable/saveable native text', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (/\/codeMirror-[^/]+\.js/.test(request.url()))
      requests.push(request.url())
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Notes window' })).toBeVisible()
  expect(requests).toHaveLength(0)
  let rejectImport!: () => void
  const held = new Promise<void>((resolve) => {
    rejectImport = resolve
  })
  await page.route('**/codeMirror-*.js', async (route) => {
    await held
    await route.abort()
  })
  await page
    .getByRole('button', { name: 'Open Code Editor', exact: true })
    .click()
  const editor = page.getByRole('region', { name: 'Code Editor window' })
  const native = editor.getByRole('textbox', { name: 'Code' })
  await native.fill('retained on failed import')
  rejectImport()
  await expect(
    editor.getByRole('status').filter({ hasText: /Rich editor unavailable/ }),
  ).toBeVisible()
  await expect(native).toHaveValue('retained on failed import')
  await native.press('Control+s')
  await saveAs(page, 'fallback.txt')
  expect(await storedText(page, 'fallback.txt')).toBe(
    'retained on failed import',
  )
  expect(requests).toHaveLength(1)
})
test('typing during delayed loading transfers latest text and focused caret; closing cannot resurrect a late view', async ({
  page,
}) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/codeMirror-*.js', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Open Code Editor', exact: true })
    .click()
  const editor = page.getByRole('region', { name: 'Code Editor window' })
  const native = editor.getByRole('textbox', { name: 'Code' })
  await native.fill('typed during load')
  await native.press('Home')
  await native.press('ArrowRight')
  release()
  const code = editor.locator('.cm-content[contenteditable="true"]')
  await expect(code).toBeFocused()
  await page.keyboard.type('X')
  await expect(code).toHaveText('tXyped during load')
  await editor
    .getByRole('button', { name: 'Close Code Editor', exact: true })
    .click()
  await page
    .getByRole('dialog', { name: 'Unsaved changes' })
    .getByRole('button', { name: 'Discard changes' })
    .click()
  await expect(page.locator('.cm-editor')).toHaveCount(0)
  for (let i = 0; i < 3; i++) {
    await openEditor(page)
    await editor
      .getByRole('button', { name: 'Close Code Editor', exact: true })
      .click()
    await expect(page.locator('.cm-editor')).toHaveCount(0)
  }
})
test('closing a window before delayed import completes never attaches an editor', async ({
  page,
}) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/codeMirror-*.js', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Open Code Editor', exact: true })
    .click()
  const editor = page.getByRole('region', { name: 'Code Editor window' })
  await expect(
    editor.getByText('Loading editor. You can keep typing.'),
  ).toBeVisible()
  await editor
    .getByRole('button', { name: 'Close Code Editor', exact: true })
    .click()
  release()
  await page.waitForResponse(/\/codeMirror-[^/]+\.js/)
  await expect(editor).toHaveCount(0)
  await expect(page.locator('.cm-editor')).toHaveCount(0)
  await openEditor(page)
  await expect(page.locator('.cm-editor')).toHaveCount(1)
})
