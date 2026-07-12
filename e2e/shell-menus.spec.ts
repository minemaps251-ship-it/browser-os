import { expect, test } from '@playwright/test'

test('active app menus save through the document session and preserve close guards', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Notes window' })
  await notes
    .getByRole('textbox', { name: 'Text', exact: true })
    .fill('Saved through the menu')
  await expect(page.getByLabel('Active application')).toHaveText('Notes')
  await page.getByRole('button', { name: 'File menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Save', exact: true }).click()
  const save = page.getByRole('dialog', { name: 'Save as' })
  await expect(save).toBeVisible()
  await save.getByRole('textbox', { name: 'File name' }).fill('menu-test.txt')
  await save.getByRole('button', { name: 'Save file', exact: true }).click()
  await expect(save).toHaveCount(0)
  await expect(notes.getByText('Saved', { exact: true })).toBeVisible()
  await notes
    .getByRole('textbox', { name: 'Text', exact: true })
    .press('ControlOrMeta+Shift+s')
  await expect(save).toBeVisible()
  await save.getByRole('button', { name: 'Cancel', exact: true }).click()
  await notes
    .getByRole('textbox', { name: 'Text', exact: true })
    .fill('Unsaved draft')
  await page.getByRole('button', { name: 'Window menu' }).click()
  await page.getByRole('menuitem', { name: 'Close window' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Unsaved changes' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    notes.getByRole('textbox', { name: 'Text', exact: true }),
  ).toHaveValue('Unsaved draft')
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Command', exact: true })
    .fill('cat menu-test.txt')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('Saved through the menu')
  await expect(page.getByRole('button', { name: 'File menu' })).toHaveCount(0)
  await page.getByRole('button', { name: 'View menu' }).click()
  await page.getByRole('menuitem', { name: 'Clear terminal' }).click()
  await expect(page.getByRole('log')).not.toContainText(
    'Saved through the menu',
  )
})

test('menus support keyboard navigation, dismissal and current app contributions', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const fileMenu = page.getByRole('button', { name: 'File menu' })
  await fileMenu.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'New folder' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'New file' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(fileMenu).toBeFocused()
  await fileMenu.click()
  await fileMenu.click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Keyboard shortcuts' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Help', exact: true }),
  ).toBeFocused()
})

test('Dock supports pinning, keyboard reorder, drag reorder and reload persistence', async ({
  page,
}) => {
  await page.goto('/')
  const dock = page.getByRole('navigation', { name: 'Running applications' })
  const names = () =>
    dock
      .getByRole('button')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('aria-label')),
      )
  const original = await names()
  const first = dock.getByRole('button').first()
  await first.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Move right', exact: true }).click()
  await expect
    .poll(names)
    .toEqual([original[1], original[0], ...original.slice(2)])
  await dock
    .getByRole('button', { name: original[0]!, exact: true })
    .dragTo(dock.getByRole('button', { name: original[1]!, exact: true }))
  await expect.poll(names).toEqual(original)
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click()
  const notes = dock.getByRole('button', { name: 'Notes', exact: true })
  await notes.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Keep in Dock' }).click()
  await expect(notes).toHaveAttribute('data-pinned', 'true')
  await page.reload()
  await expect(
    dock.getByRole('button', { name: 'Notes', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Notes window' })).toHaveCount(
    0,
  )
  await dock
    .getByRole('button', { name: 'Notes', exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Remove from Dock' }).click()
  await expect(
    dock.getByRole('button', { name: 'Notes', exact: true }),
  ).toHaveCount(0)
})

test('desktop context and settings persist wallpaper, sorting and motion preferences', async ({
  page,
}) => {
  await page.goto('/')
  await page
    .locator('#desktop-workspace')
    .click({ button: 'right', position: { x: 250, y: 150 } })
  await page.getByRole('menuitem', { name: 'Use cool wallpaper' }).click()
  await expect(page.locator('main')).toHaveAttribute('data-wallpaper', 'cool')
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Reduce interface motion' }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Reduce interface motion' }),
  ).toBeChecked()
  await page
    .getByRole('combobox', { name: 'Shortcut order' })
    .selectOption('name')
  await expect(
    page.getByRole('combobox', { name: 'Shortcut order' }),
  ).toHaveValue('name')
  await page.reload()
  await expect(page.locator('main')).toHaveAttribute('data-wallpaper', 'cool')
  await expect(page.locator('main')).toHaveAttribute(
    'data-reduce-motion',
    'true',
  )
  const names = await page
    .getByRole('navigation', { name: 'Application launcher' })
    .getByRole('button')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label')!),
    )
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
})

test('traffic lights are on the left and compact menus remain reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Notes window' })
  const close = (await notes
    .getByRole('button', { name: 'Close Notes', exact: true })
    .boundingBox())!
  const minimize = (await notes
    .getByRole('button', { name: 'Minimize Notes', exact: true })
    .boundingBox())!
  const maximize = (await notes
    .getByRole('button', { name: 'Maximize Notes', exact: true })
    .boundingBox())!
  expect(close.x).toBeLessThan(minimize.x)
  expect(minimize.x).toBeLessThan(maximize.x)
  await expect(page.getByRole('button', { name: 'File menu' })).toBeInViewport()
  await page.getByRole('button', { name: 'File menu' }).click()
  await expect(
    page.getByRole('menuitem', { name: 'Save as…' }),
  ).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Help', exact: true }),
  ).toBeInViewport()
})

test('failed desktop preference writes retain the committed layout and allow retry', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'settings' && value?.key === 'shell') {
        IDBObjectStore.prototype.put = original
        throw new DOMException(
          'Desktop settings could not be saved: storage is full.',
          'QuotaExceededError',
        )
      }
      return key === undefined
        ? original.call(this, value)
        : original.call(this, value, key)
    }
  })
  await page.getByRole('combobox', { name: 'Wallpaper' }).selectOption('cool')
  await expect(page.getByRole('alert')).toContainText('storage is full')
  await expect(page.getByRole('combobox', { name: 'Wallpaper' })).toHaveValue(
    'warm',
  )
  await expect(page.locator('main')).toHaveAttribute('data-wallpaper', 'warm')
  await page.getByRole('combobox', { name: 'Wallpaper' }).selectOption('cool')
  await expect(page.locator('main')).toHaveAttribute('data-wallpaper', 'cool')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('main')).toHaveAttribute('data-wallpaper', 'cool')
})

test('invalid saved desktop preferences are preserved until an explicit reset', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click()
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('browser-os')
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction('settings', 'readwrite')
          transaction
            .objectStore('settings')
            .put({ key: 'shell', schemaVersion: 999, value: {} })
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.onabort = () => {
            database.close()
            reject(transaction.error)
          }
        }
        request.onerror = () => reject(request.error)
      }),
  )
  await page.reload()
  await expect(page.getByRole('alert')).toContainText(
    'Saved desktop preferences are invalid',
  )
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Reset desktop preferences' }).click()
  await expect(
    page.getByRole('button', { name: 'Reset desktop preferences' }),
  ).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('shared shortcuts target the active process and ignore composition and modal dialogs', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click()
  let notes = page.getByRole('region', { name: 'Notes window' })
  const text = notes.getByRole('textbox', { name: 'Text', exact: true })
  await text.fill('Retain this draft')
  await text.dispatchEvent('keydown', {
    key: 'n',
    code: 'KeyN',
    ctrlKey: true,
    altKey: true,
    isComposing: true,
  })
  await expect(notes).toHaveCount(1)
  await text.press('Control+Alt+n')
  await expect(notes).toHaveCount(2)
  notes = notes.last()
  await notes
    .getByRole('textbox', { name: 'Text', exact: true })
    .press('ControlOrMeta+s')
  const save = page.getByRole('dialog', { name: 'Save as' })
  await expect(save).toBeVisible()
  await page.keyboard.press('Control+Alt+n')
  await expect(
    page.getByRole('region', { name: 'Notes window', includeHidden: true }),
  ).toHaveCount(2)
  await save.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page
    .getByRole('button', { name: 'Open Code Editor', exact: true })
    .click()
  const editor = page.getByRole('region', { name: 'Code Editor window' })
  await editor.getByRole('button', { name: /^Close tab/ }).click()
  await expect(editor.getByRole('tab')).toHaveCount(0)
  await page.getByRole('button', { name: 'File menu' }).click()
  await page.getByRole('menuitem', { name: 'New tab', exact: true }).click()
  await expect(editor.getByRole('tab')).toHaveCount(1)
  await expect(
    page
      .getByRole('region', { name: 'Notes window' })
      .first()
      .getByRole('textbox', { name: 'Text', exact: true }),
  ).toHaveValue('Retain this draft')
})
