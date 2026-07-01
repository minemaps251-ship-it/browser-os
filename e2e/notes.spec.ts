import { expect, test } from '@playwright/test'
test('Notes guidance and file contents remain reachable on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Notes window' })
  await expect(
    notes.getByText('Open a text file from Files to read it in Notes.'),
  ).toBeVisible()
  await notes.getByRole('button', { name: 'Close Notes', exact: true }).click()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'New file' }).click()
  const dialog = page.getByRole('dialog', { name: 'New file' })
  await dialog.getByRole('textbox').fill('mobile.txt')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  const contents = notes.getByRole('region', { name: 'File contents' })
  await expect(contents).toBeInViewport()
  await contents.focus()
  await expect(contents).toBeFocused()
  await expect(
    notes.getByRole('button', { name: 'Close Notes', exact: true }),
  ).toBeInViewport()
})

test('Notes saves shared text, protects dirty close and retains content after reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'New file' }).click()
  const create = page.getByRole('dialog', { name: 'New file' })
  await create.getByRole('textbox').fill('edit.txt')
  await create.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(create).toBeHidden()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Notes window' })
  const text = notes.getByRole('textbox', { name: 'Text' })
  await text.fill('Saved 🌍\n<script>literal</script>')
  await text.press('ControlOrMeta+s')
  await expect(
    notes.getByRole('status').filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await text.fill('Close saved text')
  await notes.getByRole('button', { name: 'Close Notes', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(text).toHaveValue('Close saved text')
  await notes.getByRole('button', { name: 'Close Notes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save and close' }).click()
  await expect(notes).toHaveCount(0)
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  const command = terminal.getByRole('textbox', { name: 'Command' })
  await expect(command).not.toHaveAttribute('readonly', '')
  await command.fill('cat edit.txt')
  await command.press('Enter')
  await expect(terminal.getByRole('log')).toContainText('Close saved text')
  await page.reload()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  await files.getByRole('button', { name: 'Select file edit.txt' }).click()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(text).toHaveValue('Close saved text')
  await text.fill('Discard this')
  await notes.getByRole('button', { name: 'Close Notes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Discard changes' }).click()
  await expect(notes).toHaveCount(0)
  await page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'Files', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(text).toHaveValue('Close saved text')
})

test('Notes keeps local edits when another tab saves and resolves conflict explicitly', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'New file' }).click()
  const create = page.getByRole('dialog', { name: 'New file' })
  await create.getByRole('textbox').fill('conflict.txt')
  await create.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(create).toBeHidden()
  await files.getByRole('button', { name: 'Open', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Notes window' })
  const text = notes.getByRole('textbox', { name: 'Text' })
  await text.fill('Local draft')
  const other = await context.newPage()
  await other.goto('/')
  await other.getByRole('button', { name: 'Open Files', exact: true }).click()
  const otherFiles = other.getByRole('region', { name: 'Files window' })
  await otherFiles
    .getByRole('button', { name: 'Select file conflict.txt' })
    .click()
  await otherFiles.getByRole('button', { name: 'Open', exact: true }).click()
  const otherNotes = other.getByRole('region', { name: 'Notes window' })
  await otherNotes
    .getByRole('textbox', { name: 'Text' })
    .fill('External version')
  await otherNotes.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    otherNotes.getByRole('status').filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await page.bringToFront()
  await page
    .getByRole('button', { name: 'Refresh workspace', exact: true })
    .click()
  await expect(notes.getByRole('alert')).toContainText('changed elsewhere')
  await expect(text).toHaveValue('Local draft')
  await expect(
    notes.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await notes.getByRole('button', { name: 'Discard edits and reload' }).click()
  await expect(text).toHaveValue('External version')
  await expect(
    notes.getByRole('status').filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await other.close()
})
