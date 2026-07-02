import { expect, test, type Locator, type Page } from '@playwright/test'
/** Use real Tab navigation: no pointer clicks or programmatic element focus. */
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible()
  for (let i = 0; i < 80; i++) {
    if (
      await target.evaluate(
        (element) => element === element.ownerDocument.activeElement,
      )
    )
      return
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}
async function activate(page: Page, target: Locator) {
  await tabTo(page, target)
  await page.keyboard.press('Enter')
}
test('keyboard-only MVP creates, edits, cancels close, saves, reads and reloads a shared file', async ({
  page,
}) => {
  await page.goto('/')
  await activate(
    page,
    page.getByRole('button', { name: 'Open Files', exact: true }),
  )
  const files = page.getByRole('region', { name: 'Files window' })
  await activate(
    page,
    files.getByRole('button', { name: 'New folder', exact: true }),
  )
  let dialog = page.getByRole('dialog', { name: 'New folder' })
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused()
  await page.keyboard.type('projects')
  await activate(
    page,
    dialog.getByRole('button', { name: 'Create', exact: true }),
  )
  await expect(dialog).toBeHidden()
  await activate(
    page,
    files.getByRole('button', { name: 'Open folder projects', exact: true }),
  )
  await activate(
    page,
    files.getByRole('button', { name: 'New file', exact: true }),
  )
  dialog = page.getByRole('dialog', { name: 'New file' })
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused()
  await page.keyboard.type('hello.txt')
  await activate(
    page,
    dialog.getByRole('button', { name: 'Create', exact: true }),
  )
  await expect(dialog).toBeHidden()
  await activate(page, files.getByRole('button', { name: 'Open', exact: true }))
  const notes = page.getByRole('region', { name: 'Notes window' })
  const text = notes.getByRole('textbox', { name: 'Text' })
  await tabTo(page, text)
  await page.keyboard.type('Keyboard MVP text')
  await activate(
    page,
    notes.getByRole('button', { name: 'Close Notes', exact: true }),
  )
  const close = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(
    close.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(close).toBeHidden()
  await expect(text).toHaveValue('Keyboard MVP text')
  await activate(
    page,
    notes.getByRole('button', { name: 'Close Notes', exact: true }),
  )
  await activate(page, close.getByRole('button', { name: 'Save and close' }))
  await expect(notes).toHaveCount(0)
  await activate(
    page,
    page.getByRole('button', { name: 'Open Terminal', exact: true }),
  )
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  const input = terminal.getByRole('textbox', { name: 'Command' })
  await expect(input).not.toHaveAttribute('readonly', '')
  await tabTo(page, input)
  await page.keyboard.type('cat /home/user/projects/hello.txt')
  await page.keyboard.press('Enter')
  await expect(terminal.getByRole('log')).toContainText('Keyboard MVP text')
  await expect(input).not.toHaveAttribute('readonly', '')
  await page.keyboard.type('echo unfinished')
  await page.keyboard.press('Control+l')
  await expect(terminal.getByRole('log')).toBeEmpty()
  await expect(input).toHaveValue('echo unfinished')

  await activate(
    page,
    page.getByRole('button', { name: 'Open Settings', exact: true }),
  )
  const settings = page.getByRole('region', { name: 'Settings window' })
  await tabTo(
    page,
    settings.getByRole('radio', { name: 'System', exact: true }),
  )
  await page.keyboard.press('ArrowRight')
  const light = settings.getByRole('radio', { name: 'Light', exact: true })
  await expect(light).toBeChecked()
  await expect(light).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const dark = settings.getByRole('radio', { name: 'Dark', exact: true })
  await expect(dark).toBeChecked()
  await expect(dark).toBeFocused()
  await activate(
    page,
    settings.getByRole('button', { name: 'Minimize Settings', exact: true }),
  )
  await activate(
    page,
    page.getByRole('button', { name: 'Settings (minimized)', exact: true }),
  )
  await expect(settings).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Notes window' })).toHaveCount(
    0,
  )
  await activate(
    page,
    page.getByRole('button', { name: 'Open Files', exact: true }),
  )
  await activate(
    page,
    files.getByRole('button', { name: 'Open folder projects', exact: true }),
  )
  await activate(
    page,
    files.getByRole('button', { name: 'Select file hello.txt', exact: true }),
  )
  await activate(page, files.getByRole('button', { name: 'Open', exact: true }))
  await expect(text).toHaveValue('Keyboard MVP text')
  await expect(page.getByRole('combobox', { name: 'Appearance' })).toHaveValue(
    'dark',
  )
})
test('temporary MVP keeps text for the session and loses it only after explicit reload', async ({
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
  await page.goto('/')
  await page.getByRole('button', { name: 'Use a temporary workspace' }).click()
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Notes window' })
  await notes.getByRole('textbox', { name: 'Text' }).fill('Temporary text')
  await notes.getByRole('button', { name: 'Save', exact: true }).click()
  const save = page.getByRole('dialog', { name: 'Save as' })
  await save.getByRole('textbox', { name: 'File name' }).fill('temporary.txt')
  await save.getByRole('button', { name: 'Save file' }).click()
  await expect(save).toBeHidden()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  const input = terminal.getByRole('textbox', { name: 'Command' })
  await expect(input).not.toHaveAttribute('readonly', '')
  await input.fill('cat temporary.txt')
  await input.press('Enter')
  await expect(terminal.getByRole('log')).toContainText('Temporary text')
  await page.reload()
  await page.getByRole('button', { name: 'Use a temporary workspace' }).click()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Select file temporary.txt' }),
  ).toHaveCount(0)
})
