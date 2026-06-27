import { expect, test } from '@playwright/test'

test('manual Refresh reads another tab without restarting apps or clearing focus', async ({
  page,
  context,
}) => {
  await page.goto('/')
  const choice = page.getByRole('combobox', { name: 'Appearance' })
  await expect(choice).toHaveValue('system')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  const frame = page.getByRole('region', { name: 'About BrowserOS window' })
  const id = await frame.getAttribute('id')
  const writer = await context.newPage()
  await writer.goto('/')
  await writer
    .getByRole('combobox', { name: 'Appearance' })
    .selectOption('dark')
  await expect(
    writer.getByRole('combobox', { name: 'Appearance' }),
  ).toHaveValue('dark')
  const refresh = page.getByRole('button', { name: 'Refresh workspace' })
  await refresh.focus()
  await refresh.press('Enter')
  await expect(choice).toHaveValue('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(refresh).toBeEnabled()
  await expect(refresh).toBeFocused()
  await expect(frame).toHaveAttribute('id', id!)
})

test('returning to a visible tab re-reads settings from another tab', async ({
  page,
  context,
}) => {
  await page.goto('/')
  const choice = page.getByRole('combobox', { name: 'Appearance' })
  await expect(choice).toHaveValue('system')
  const writer = await context.newPage()
  await writer.goto('/')
  await writer
    .getByRole('combobox', { name: 'Appearance' })
    .selectOption('dark')
  await expect(
    writer.getByRole('combobox', { name: 'Appearance' }),
  ).toHaveValue('dark')
  // Headless Chromium can keep both pages visible; drive the browser adapter event explicitly.
  await page.evaluate(() => {
    const surface = globalThis as unknown as {
      document: {
        visibilityState: string
        dispatchEvent(event: Event): boolean
      }
    }
    Object.defineProperty(surface.document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    surface.document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(choice).toHaveValue('system')
  await page.evaluate(() => {
    const surface = globalThis as unknown as {
      document: {
        visibilityState: string
        dispatchEvent(event: Event): boolean
      }
    }
    Object.defineProperty(surface.document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    surface.document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(choice).toHaveValue('dark')
})
