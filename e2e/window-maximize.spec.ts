import { expect, test } from '@playwright/test'
test('maximizes to workspace, keeps placement through minimize and restores original bounds', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  const frame = page.getByRole('region', { name: 'About BrowserOS window' })
  await expect(frame).toBeVisible()
  const original = await frame.boundingBox()
  const id = await frame.getAttribute('id')
  await page.getByRole('button', { name: 'Maximize About BrowserOS' }).click()
  await expect(frame).toHaveAttribute('data-maximized', 'true')
  expect(await frame.boundingBox()).toEqual(
    await page.locator('#desktop-workspace').boundingBox(),
  )
  await expect(frame.locator('[data-resize-edge]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Minimize About BrowserOS' }).click()
  await page
    .getByRole('button', { name: 'About BrowserOS (minimized)' })
    .click()
  await expect(frame).toHaveAttribute('data-maximized', 'true')
  await expect(frame).toHaveAttribute('id', id!)
  await page
    .getByRole('button', { name: 'Restore size of About BrowserOS' })
    .focus()
  await page.keyboard.press('Enter')
  await expect(frame).toHaveAttribute('data-maximized', 'false')
  expect(await frame.boundingBox()).toEqual(original)
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: 'Maximize About BrowserOS' }).click()
    await page
      .getByRole('button', { name: 'Restore size of About BrowserOS' })
      .click()
    expect(await frame.boundingBox()).toEqual(original)
    await expect(frame).toHaveAttribute('id', id!)
  }
})
test('menu maximize tracks viewport and restores safely after desktop/mobile changes', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  const frame = page.getByRole('region', { name: 'About BrowserOS window' })
  await page
    .getByRole('button', { name: 'Window actions for About BrowserOS' })
    .click()
  await page.getByRole('menuitem', { name: 'Maximize window' }).click()
  await page.setViewportSize({ width: 800, height: 600 })
  await expect
    .poll(async () => frame.boundingBox())
    .toEqual(await page.locator('#desktop-workspace').boundingBox())
  await page.getByRole('button', { name: 'Minimize About BrowserOS' }).click()
  await page.setViewportSize({ width: 1000, height: 700 })
  await page
    .getByRole('button', { name: 'About BrowserOS (minimized)' })
    .click()
  await expect
    .poll(async () => frame.boundingBox())
    .toEqual(await page.locator('#desktop-workspace').boundingBox())
  await page
    .getByRole('button', { name: 'Window actions for About BrowserOS' })
    .click()
  await expect(page.getByRole('menuitem', { name: 'Move window' })).toHaveCount(
    0,
  )
  await page.getByRole('menuitem', { name: 'Restore window size' }).click()
  await expect(frame).toHaveAttribute('data-maximized', 'false')
  await page.setViewportSize({ width: 375, height: 667 })
  await expect(frame).toHaveCSS('width', '355px')
  await page.getByRole('button', { name: 'Maximize About BrowserOS' }).click()
  await expect(
    page.getByRole('button', { name: 'Restore size of About BrowserOS' }),
  ).toBeInViewport()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect
    .poll(async () => frame.boundingBox())
    .toEqual(await page.locator('#desktop-workspace').boundingBox())
  await page
    .getByRole('button', { name: 'Restore size of About BrowserOS' })
    .click()
  // Normal windows already clamp on viewport shrink; maximize saves that size.
  await expect(frame).toHaveCSS('width', '355px')
})
