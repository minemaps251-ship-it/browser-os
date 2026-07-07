import { expect, test } from '@playwright/test'

test('short viewport keeps modal content scrollable and keyboard actions reachable', async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  const create = files.getByRole('button', { name: 'New file', exact: true })
  await create.focus()
  await create.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'New file' })
  const input = dialog.getByRole('textbox', { name: 'Name', exact: true })
  await expect(input).toBeFocused()
  await page.setViewportSize({ width: 375, height: 240 })
  const box = (await dialog.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(240)
  const tab =
    browserName === 'webkit' && process.platform === 'darwin'
      ? 'Alt+Tab'
      : 'Tab'
  await input.press(tab)
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press(tab)
  const submit = dialog.getByRole('button', { name: 'Create', exact: true })
  await expect(submit).toBeFocused()
  await expect(submit).toBeInViewport()
  await page.keyboard.press(tab)
  // Native modal navigation may visit browser chrome; background controls stay inert.
  expect(
    await dialog.evaluate(
      (node) =>
        document.activeElement === document.body ||
        node.contains(document.activeElement),
    ),
  ).toBe(true)
  // Engines differ in whether browser chrome occupies a step at the wrap boundary.
  for (
    let step = 0;
    step < 3 &&
    !(await submit.evaluate((node) => node === document.activeElement));
    step++
  ) {
    await page.keyboard.press(`Shift+${tab}`)
  }
  await expect(submit).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(create).toBeFocused()
})

test('compact layout exposes named modal validation and returns focus after cancellation', async ({
  page,
}) => {
  // Layout equivalent to 1280x800 at 200%; actual browser zoom is a manual gate.
  await page.setViewportSize({ width: 640, height: 400 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  const trigger = files.getByRole('button', { name: 'New file', exact: true })
  await trigger.focus()
  await trigger.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'New file' })
  await expect(dialog).toHaveAccessibleName('New file')
  await expect(dialog).toHaveAccessibleDescription(/Create in/)
  const input = dialog.getByRole('textbox', { name: 'Name', exact: true })
  await input.fill('bad/name')
  await input.press('Enter')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(input).toHaveAccessibleDescription(/.+/)
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(input).toBeFocused()
  await input.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(await page.locator('html').evaluate((node) => node.scrollWidth)).toBe(
    640,
  )
})

test('forced colors retain file selection, window symbols and keyboard focus', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  const folder = files.getByRole('button', {
    name: 'Select folder Documents',
    exact: true,
  })
  await folder.focus()
  await folder.press('Enter')
  await expect(folder).toHaveAttribute('aria-pressed', 'true')
  const row = files.getByRole('button', {
    name: 'Open folder Documents',
    exact: true,
  })
  expect(
    await row.evaluate((node) => getComputedStyle(node).outlineStyle),
  ).toBe('solid')
  const close = files.getByRole('button', { name: 'Close Files', exact: true })
  await close.focus()
  expect(
    await close.evaluate((node) => getComputedStyle(node).outlineStyle),
  ).toBe('solid')
  expect(
    await close
      .locator('svg')
      .evaluate((node) => getComputedStyle(node).opacity),
  ).toBe('1')
})
