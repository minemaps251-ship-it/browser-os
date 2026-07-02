import { expect, test } from '@playwright/test'
test('Settings shares durable theme with the desktop and restores one instance', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const launcher = page.getByRole('button', {
    name: 'Open Settings',
    exact: true,
  })
  await launcher.click()
  const frame = page.getByRole('region', { name: 'Settings window' })
  await expect(frame.getByText('Saved in this browser')).toBeVisible()
  await frame.getByRole('radio', { name: 'Dark', exact: true }).click()
  await expect(
    frame.getByRole('radio', { name: 'Dark', exact: true }),
  ).toBeChecked()
  await expect(page.getByRole('combobox', { name: 'Appearance' })).toHaveValue(
    'dark',
  )
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await frame
    .getByRole('button', { name: 'Minimize Settings', exact: true })
    .click()
  await launcher.click()
  await expect(frame).toHaveCount(1)
  await expect(frame).toBeVisible()
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('light')
  await expect(
    frame.getByRole('radio', { name: 'Light', exact: true }),
  ).toBeChecked()
  await frame.getByRole('radio', { name: 'System', exact: true }).click()
  await expect(
    frame.getByRole('radio', { name: 'System', exact: true }),
  ).toBeChecked()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await frame.getByRole('radio', { name: 'Light', exact: true }).click()
  await expect(
    frame.getByRole('radio', { name: 'Light', exact: true }),
  ).toBeChecked()
  await page.reload()
  await launcher.click()
  await expect(
    frame.getByRole('radio', { name: 'Light', exact: true }),
  ).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
test('Settings radios and close remain keyboard reachable on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click()
  const frame = page.getByRole('region', { name: 'Settings window' })
  const system = frame.getByRole('radio', { name: 'System', exact: true })
  await expect(system).toBeInViewport()
  await system.focus()
  await page.keyboard.press('ArrowRight')
  await expect(
    frame.getByRole('radio', { name: 'Light', exact: true }),
  ).toBeChecked()
  await expect(
    frame.getByRole('button', { name: 'Close Settings', exact: true }),
  ).toBeInViewport()
})
