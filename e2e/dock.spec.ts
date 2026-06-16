import { expect, test } from '@playwright/test'

test('Dock stays visible and launches/restores the same window with keyboard labels', async ({
  page,
}) => {
  await page.goto('/')
  const dock = page.getByRole('navigation', { name: 'Running applications' })
  const icon = dock.getByRole('button', { name: 'About BrowserOS' })
  await expect(icon).toBeVisible()
  const before = await page.locator('#desktop-workspace').boundingBox()
  await icon.focus()
  await expect(
    page.locator('footer').getByText('About BrowserOS', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.locator('footer').getByText('About BrowserOS', { exact: true }),
  ).toHaveCount(0)
  await page.keyboard.press('Enter')
  const window = page.getByRole('region', { name: 'About BrowserOS window' })
  await expect(window).toBeVisible()
  const id = await window.getAttribute('id')
  await page.getByRole('button', { name: 'Minimize About BrowserOS' }).click()
  await dock
    .getByRole('button', { name: 'About BrowserOS (minimized)' })
    .click()
  await expect(window).toBeFocused()
  await expect(window).toHaveAttribute('id', id!)
  await page.getByRole('button', { name: 'Close About BrowserOS' }).click()
  await expect(icon).toBeVisible()
  await expect(icon).toHaveAttribute('data-running', 'false')
  expect(await page.locator('#desktop-workspace').boundingBox()).toEqual(before)
})

test('Dock label remains visible above the scroll area on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  const icon = page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'About BrowserOS' })
  await expect(icon).toBeInViewport()
  await icon.hover()
  await expect(
    page.locator('footer').getByText('About BrowserOS', { exact: true }),
  ).toBeInViewport()
  expect(await page.locator('html').evaluate((el) => el.scrollWidth)).toBe(320)
})
