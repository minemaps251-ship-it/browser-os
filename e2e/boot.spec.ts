import { expect, test } from '@playwright/test'

test('boots BrowserOS, launches About, and closes with keyboard focus restored', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveTitle('BrowserOS')
  await expect(page.getByRole('heading', { name: 'BrowserOS' })).toBeVisible()
  const launcher = page.getByRole('button', { name: 'Open About BrowserOS' })
  await launcher.focus()
  await page.keyboard.press('Enter')
  const window = page.getByRole('region', { name: 'About BrowserOS window' })
  await expect(window).toBeVisible()
  await expect(window).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Window actions for About BrowserOS' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  const close = page.getByRole('button', { name: 'Close About BrowserOS' })
  await expect(close).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(window).toHaveCount(0)
  await expect(launcher).toBeFocused()
  await expect(page.getByText('No applications running')).toBeVisible()
})

test('keeps the About controls reachable on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  const close = page.getByRole('button', { name: 'Close About BrowserOS' })
  await expect(close).toBeInViewport()
  await close.click()
  await expect(
    page.getByRole('region', { name: 'About BrowserOS window' }),
  ).toHaveCount(0)
})
