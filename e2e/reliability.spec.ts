import { expect, test } from '@playwright/test'

test('repeated editor and export window cycles release views and Blob URLs and keep the shell usable', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const active = new Set<string>()
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (object) => {
      const url = create(object)
      active.add(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      active.delete(url)
      revoke(url)
    }
    Object.defineProperty(window, '__activeExportUrls', {
      get: () => active.size,
    })
  })
  await page.goto('/')
  for (let cycle = 0; cycle < 5; cycle++) {
    await page
      .getByRole('button', { name: 'Open Code Editor', exact: true })
      .click()
    const editor = page.getByRole('region', { name: 'Code Editor window' })
    const code = editor.locator('.cm-content[contenteditable="true"]')
    await expect(code).toBeVisible()
    await expect(code).toHaveText('')
    await code.fill(`const cycle = ${cycle}`)
    await editor
      .getByRole('button', { name: 'Close Code Editor', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator('.cm-editor')).toHaveCount(0)

    await page
      .getByRole('button', { name: 'Open Settings', exact: true })
      .click()
    const settings = page.getByRole('region', { name: 'Settings window' })
    await settings
      .getByRole('button', { name: 'Prepare export', exact: true })
      .click()
    await expect(
      settings.getByRole('link', { name: 'Download JSON' }),
    ).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, '__activeExportUrls') as number,
        ),
      )
      .toBe(1)
    await settings
      .getByRole('button', { name: 'Close Settings', exact: true })
      .click()
    await expect(settings).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, '__activeExportUrls') as number,
        ),
      )
      .toBe(0)
  }
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  const command = terminal.getByRole('textbox', { name: 'Command' })
  await expect(command).not.toHaveAttribute('readonly', '')
  await command.fill('echo lifecycle-ok')
  await command.press('Enter')
  await expect(terminal.getByRole('log')).toContainText('lifecycle-ok')
  expect(errors).toEqual([])
})
