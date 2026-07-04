import { expect, test } from '@playwright/test'

test('Files opens Editor independently, keyboard save shares text with Terminal and survives reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'New file' }).click()
  const create = page.getByRole('dialog', { name: 'New file' })
  await create.getByRole('textbox', { name: 'Name' }).fill('source.txt')
  await create.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(create).toBeHidden()
  await files.getByRole('button', { name: 'Open in Code Editor' }).click()
  const editor = page.getByRole('region', { name: 'Code Editor window' })
  const code = editor.locator('.cm-content[contenteditable="true"]')
  await code.fill('const answer = 42;\n<script>literal</script>')
  await code.press('Control+s')
  await expect(
    editor.getByRole('status').filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await editor
    .getByRole('button', { name: 'Minimize Code Editor', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open in Code Editor' }).click()
  await expect(editor).toHaveCount(1)
  await expect(code.locator('.cm-line')).toHaveText([
    'const answer = 42;',
    '<script>literal</script>',
  ])
  await code.fill('unsaved draft')
  await editor
    .getByRole('button', { name: 'Close Code Editor', exact: true })
    .click()
  const close = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(
    close.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(close).toBeHidden()
  await expect(code).toHaveText('unsaved draft')
  await editor
    .getByRole('button', { name: 'Close Code Editor', exact: true })
    .click()
  await close.getByRole('button', { name: 'Discard changes' }).click()
  await expect(editor).toHaveCount(0)
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  const input = terminal.getByRole('textbox', { name: 'Command' })
  await expect(input).not.toHaveAttribute('readonly', '')
  await input.fill('cat source.txt')
  await input.press('Enter')
  await expect(terminal.getByRole('log')).toContainText('const answer = 42;')
  await page.reload()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  await files
    .getByRole('button', { name: 'Select file source.txt', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open in Code Editor' }).click()
  await expect(code.locator('.cm-line')).toHaveText([
    'const answer = 42;',
    '<script>literal</script>',
  ])
  await editor
    .getByRole('button', { name: 'Minimize Code Editor', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: 'Notes window' })
      .getByRole('textbox', { name: 'Text' }),
  ).toHaveValue('const answer = 42;\n<script>literal</script>')
})

test('new Editor uses Save As and remains keyboard reachable on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Open Code Editor', exact: true })
    .click()
  const editor = page.getByRole('region', { name: 'Code Editor window' })
  const code = editor.locator('.cm-content[contenteditable="true"]')
  await expect(code).toBeInViewport()
  await code.fill('hello from Editor')
  await code.press('Control+s')
  const save = page.getByRole('dialog', { name: 'Save as' })
  const name = save.getByRole('textbox', { name: 'File name' })
  await expect(name).toBeFocused()
  await name.fill('new-source.txt')
  await save.getByRole('button', { name: 'Save file' }).click()
  await expect(save).toBeHidden()
  await expect(
    editor.getByRole('heading', { name: 'new-source.txt' }),
  ).toBeVisible()
  const close = editor.getByRole('button', {
    name: 'Close Code Editor',
    exact: true,
  })
  await expect(close).toBeInViewport()
  await close.focus()
  await page.keyboard.press('Enter')
  await expect(editor).toHaveCount(0)
})
