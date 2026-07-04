import { expect, test, type Page } from '@playwright/test'
async function openTwo(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  const editor = page.getByRole('region', { name: 'Code Editor window' })
  for (const name of ['one.txt', 'two.txt']) {
    await files.getByRole('button', { name: 'New file' }).click()
    const create = page.getByRole('dialog', { name: 'New file' })
    await create.getByRole('textbox', { name: 'Name' }).fill(name)
    await create.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(create).toBeHidden()
    await files.getByRole('button', { name: 'Open in Code Editor' }).click()
    await expect(editor.getByRole('tab', { name, exact: true })).toBeVisible()
    if (name === 'one.txt')
      await editor
        .getByRole('button', { name: 'Minimize Code Editor', exact: true })
        .click()
  }
  await expect(editor).toHaveCount(1)
  await expect(editor.getByRole('tab')).toHaveCount(2)
  return { files, editor }
}
test('tabs keep independent drafts, save and close only the active file, restore focus and survive reload through VFS', async ({
  page,
}) => {
  const { editor, files } = await openTwo(page)
  await editor.getByRole('tab', { name: 'one.txt', exact: true }).click()
  const code = editor.getByRole('textbox', { name: 'Code' })
  await code.fill('first draft')
  await editor.getByRole('tab', { name: 'two.txt', exact: true }).click()
  await code.fill('second saved')
  await code.press('Control+s')
  await expect(
    editor.getByRole('status').filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  const second = editor.getByRole('tab', { name: 'two.txt', exact: true })
  await second.focus()
  await page.keyboard.press('ArrowLeft')
  const first = editor.getByRole('tab', {
    name: 'one.txt, unsaved changes',
    exact: true,
  })
  await expect(first).toBeFocused()
  await expect(code).toHaveValue('first draft')
  await page.keyboard.press('Delete')
  const close = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(
    close.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(close).toBeHidden()
  await expect(code).toHaveValue('first draft')
  await editor
    .getByRole('button', { name: 'Close tab one.txt', exact: true })
    .click()
  await close.getByRole('button', { name: 'Save and close' }).click()
  await expect(editor.getByRole('tab')).toHaveCount(1)
  await expect(second).toBeFocused()
  await expect(code).toHaveValue('second saved')
  await editor
    .getByRole('button', { name: 'Minimize Code Editor', exact: true })
    .click()
  await files
    .getByRole('button', { name: 'Select file one.txt', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open in Code Editor' }).click()
  await expect(editor.getByRole('tab')).toHaveCount(2)
  await expect(code).toHaveValue('first draft')
  await editor
    .getByRole('button', { name: 'Minimize Code Editor', exact: true })
    .click()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  const input = terminal.getByRole('textbox', { name: 'Command' })
  await expect(input).not.toHaveAttribute('readonly', '')
  await input.fill('cat one.txt')
  await input.press('Enter')
  await expect(terminal.getByRole('log')).toContainText('first draft')
  await expect(input).not.toHaveAttribute('readonly', '')
  await input.fill('cat two.txt')
  await input.press('Enter')
  await expect(terminal.getByRole('log')).toContainText('second saved')
  await page.reload()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  await files
    .getByRole('button', { name: 'Select file one.txt', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open in Code Editor' }).click()
  await expect(code).toHaveValue('first draft')
  await expect(editor.getByRole('tab')).toHaveCount(1)
})
test('aggregate close retains earlier discarded drafts on Cancel and saves an Untitled tab through a single Save As dialog', async ({
  page,
}) => {
  const { editor } = await openTwo(page)
  await editor.getByRole('tab', { name: 'one.txt', exact: true }).click()
  const code = editor.getByRole('textbox', { name: 'Code' })
  await code.fill('first retained')
  await editor.getByRole('tab', { name: 'two.txt', exact: true }).click()
  await code.fill('second retained')
  await editor
    .getByRole('button', { name: 'Close Code Editor', exact: true })
    .click()
  const close = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(close).toContainText('one.txt')
  await close.getByRole('button', { name: 'Discard changes' }).click()
  await expect(close).toContainText('two.txt')
  await close.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(close).toBeHidden()
  await editor
    .getByRole('tab', { name: 'one.txt, unsaved changes', exact: true })
    .click()
  await expect(code).toHaveValue('first retained')
  await editor.getByRole('button', { name: 'New tab', exact: true }).click()
  await code.fill('new tab saved')
  await editor
    .getByRole('button', { name: 'Close Code Editor', exact: true })
    .click()
  await expect(close).toContainText('one.txt')
  await close.getByRole('button', { name: 'Save and close' }).click()
  await expect(close).toContainText('two.txt')
  await close.getByRole('button', { name: 'Save and close' }).click()
  await expect(close).toContainText('Untitled')
  await close.getByRole('button', { name: 'Save and close' }).click()
  const save = page.getByRole('dialog', { name: 'Save as' })
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await save.getByRole('textbox', { name: 'File name' }).fill('third.txt')
  await save.getByRole('button', { name: 'Save file' }).click()
  await expect(editor).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files
    .getByRole('button', { name: 'Select file third.txt', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open in Code Editor' }).click()
  await expect(code).toHaveValue('new tab saved')
})
test('inactive tab conflicts are retained and keyboard tab navigation works on a narrow viewport', async ({
  page,
}) => {
  const { editor, files } = await openTwo(page)
  await editor.getByRole('tab', { name: 'one.txt', exact: true }).click()
  const code = editor.getByRole('textbox', { name: 'Code' })
  await code.fill('local draft')
  await editor.getByRole('tab', { name: 'two.txt', exact: true }).click()
  await editor
    .getByRole('button', { name: 'Minimize Code Editor', exact: true })
    .click()
  await files
    .getByRole('button', { name: 'Select file one.txt', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Notes window' })
  await notes.getByRole('textbox', { name: 'Text' }).fill('outside saved')
  await notes.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    notes.getByRole('status').filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await notes
    .getByRole('button', { name: 'Minimize Notes', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Code Editor (minimized)', exact: true })
    .click()
  await page.setViewportSize({ width: 375, height: 667 })
  const second = editor.getByRole('tab', { name: 'two.txt', exact: true })
  await second.focus()
  await page.keyboard.press('Home')
  await expect(
    editor.getByRole('tab', { name: 'one.txt, unsaved changes', exact: true }),
  ).toBeFocused()
  await expect(code).toHaveValue('local draft')
  await expect(
    editor.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await editor.getByRole('button', { name: 'Discard edits and reload' }).click()
  await expect(code).toHaveValue('outside saved')
  await expect(
    editor.getByRole('button', { name: 'Close Code Editor', exact: true }),
  ).toBeInViewport()
})
