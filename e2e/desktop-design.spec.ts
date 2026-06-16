import { expect, test } from '@playwright/test'

for (const colorScheme of ['light', 'dark'] as const) {
  test(`desktop shortcuts stay clickable behind empty window layer (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme })
    await page.goto('/')
    const launcher = page.getByRole('button', { name: 'Open About BrowserOS' })
    await expect(page.getByRole('time')).toBeVisible()
    await launcher.click()
    const window = page.getByRole('region', { name: 'About BrowserOS window' })
    await expect(window).toBeVisible()
    await page.getByRole('button', { name: 'Minimize About BrowserOS' }).click()
    await expect(window).toBeHidden()
    await expect(launcher).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(window).toBeVisible()
    await expect(window).toBeFocused()
    await expect(window).toHaveCount(1)
  })
}

test('system bar, shortcut and window fit a small desktop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  const launcher = page.getByRole('button', { name: 'Open About BrowserOS' })
  await expect(launcher).toBeInViewport()
  await expect(page.getByRole('time')).toBeInViewport()
  await launcher.click()
  await expect(
    page.getByRole('button', { name: 'Close About BrowserOS' }),
  ).toBeInViewport()
  expect(
    await page.locator('html').evaluate((element) => element.scrollWidth),
  ).toBe(320)
})
