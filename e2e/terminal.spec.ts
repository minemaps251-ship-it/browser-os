import { expect, test, type Locator } from '@playwright/test'
async function command(frame: Locator, text: string) {
  const input = frame.getByRole('textbox', { name: 'Command' })
  await expect(input).not.toHaveAttribute('readonly', '')
  await input.fill(text)
  await input.press('Enter')
  await expect(frame.getByRole('log')).toContainText(`$ ${text}`)
  await expect(input).not.toHaveAttribute('readonly', '')
}
test('Terminal reads Files changes, retains stable cwd after rename and sees durable files after reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'Open folder Documents' }).click()
  await expect(files.getByRole('button', { name: 'New file' })).toBeEnabled()
  await files.getByRole('button', { name: 'New file' }).click()
  const dialog = page.getByRole('dialog', { name: 'New file' })
  await dialog.getByRole('textbox').fill('read me.txt')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  await command(terminal, 'pwd')
  await expect(terminal.getByRole('log')).toContainText('/home/user')
  await command(terminal, 'cd Documents')
  await command(terminal, 'ls')
  await expect(terminal.getByRole('log')).toContainText('read me.txt')
  await page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'Files', exact: true })
    .click()
  await files.getByRole('button', { name: 'Up', exact: true }).click()
  await files.getByRole('button', { name: 'Select folder Documents' }).click()
  await files.getByRole('button', { name: 'Rename', exact: true }).click()
  await files.getByRole('textbox', { name: 'Rename Documents' }).fill('Work')
  await files.getByRole('button', { name: 'Save name' }).click()
  await expect(
    terminal.getByText('/home/user/Work', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'Terminal', exact: true })
    .click()
  await command(terminal, 'pwd')
  await expect(terminal.getByRole('log')).toContainText('/home/user/Work')
  await page.reload()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  await expect(terminal.getByRole('log')).toBeEmpty()
  await command(terminal, 'ls Work')
  await expect(terminal.getByRole('log')).toContainText('read me.txt')
})
test('Terminal windows navigate independently, report errors and restore from Dock', async ({
  page,
}) => {
  await page.goto('/')
  const launcher = page.getByRole('button', {
    name: 'Open Terminal',
    exact: true,
  })
  await launcher.click()
  const frames = page.getByRole('region', { name: 'Terminal window' })
  await command(frames.first(), 'cd Documents')
  await launcher.click()
  await expect(frames).toHaveCount(2)
  await command(frames.nth(1), 'pwd')
  await expect(
    frames
      .nth(1)
      .getByRole('paragraph')
      .filter({ hasText: /^\/home\/user$/ }),
  ).toBeVisible()
  await expect(
    frames.first().getByText('/home/user/Documents', { exact: true }),
  ).toBeVisible()
  await command(frames.nth(1), 'cd missing')
  await expect(frames.nth(1).getByRole('log')).toContainText(
    'No such file or folder',
  )
  await command(frames.nth(1), 'ls | pwd')
  await expect(frames.nth(1).getByRole('log')).toContainText('Shell operators')
  await frames
    .nth(1)
    .getByRole('button', { name: 'Minimize Terminal', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'Terminal', exact: true })
    .click()
  await expect(frames).toHaveCount(2)
})
test('Terminal input, output and controls remain reachable on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const frame = page.getByRole('region', { name: 'Terminal window' })
  await expect(frame.getByRole('textbox')).toBeInViewport()
  await command(frame, 'help')
  await expect(frame.getByRole('log')).toContainText('ls [path]')
  await frame.getByRole('textbox').scrollIntoViewIfNeeded()
  await expect(frame.getByRole('textbox')).toBeInViewport()
  await expect(
    frame.getByRole('button', { name: 'Close Terminal', exact: true }),
  ).toBeInViewport()
})
