import { expect, test } from '@playwright/test'

test('minimizes by keyboard, excludes hidden chrome from Tab, restores the same window', async ({
  page,
}) => {
  await page.goto('/')
  const launcher = page.getByRole('button', { name: 'Open About BrowserOS' })
  await launcher.click()
  const frame = page.locator('section[aria-label="About BrowserOS window"]')
  const id = await frame.getAttribute('id')
  await page.getByRole('button', { name: 'Minimize About BrowserOS' }).focus()
  await page.keyboard.press('Enter')
  await expect(frame).toBeHidden()
  await expect(frame).toHaveAttribute('inert', '')
  await expect(launcher).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Open Files', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  const task = page.getByRole('button', { name: 'About BrowserOS (minimized)' })
  await expect(task).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(frame).toBeVisible()
  await expect(frame).toBeFocused()
  await expect(frame).toHaveAttribute('id', id!)
  await expect(frame).toHaveCSS('width', '560px')
  await page.getByRole('button', { name: 'Minimize About BrowserOS' }).click()
  await launcher.click()
  await expect(frame).toBeVisible()
  await expect(frame).toHaveAttribute('id', id!)
  await expect(
    page.getByRole('region', { name: 'About BrowserOS window' }),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Close About BrowserOS' }).click()
  await expect(
    page.getByRole('navigation', { name: 'Running applications' }),
  ).toBeVisible()
})

test('cancels move/resize previews on minimize and survives repeated restore', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  const frame = page.locator('section[aria-label="About BrowserOS window"]')
  for (const kind of ['move', 'resize']) {
    for (let i = 0; i < 3; i++) {
      const target =
        kind === 'move'
          ? frame.locator('header')
          : frame.locator('[data-resize-edge="se"]')
      const box = (await target.boundingBox())!
      const x = box.x + (kind === 'move' ? 150 : box.width / 2),
        y = box.y + (kind === 'move' ? 24 : box.height / 2)
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 40, y + 30)
      await page
        .getByRole('button', { name: 'Minimize About BrowserOS' })
        .evaluate((button) => button.click())
      await page.mouse.up()
      await expect(frame).toBeHidden()
      await page
        .getByRole('button', { name: 'About BrowserOS (minimized)' })
        .click()
      await expect(frame).toHaveCSS('left', '24px')
      await expect(frame).toHaveCSS('top', '24px')
      await expect(frame).toHaveCSS('width', '560px')
      await expect(frame).toHaveCSS('height', '440px')
    }
  }
  await page
    .getByRole('button', { name: 'Window actions for About BrowserOS' })
    .click()
  await page.getByRole('menuitem', { name: 'Resize window' }).click()
  await page.keyboard.press('ArrowRight')
  await frame
    .locator('button[aria-label="Minimize About BrowserOS"]')
    .evaluate((button) => button.click())
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'About BrowserOS (minimized)' })
    .click()
  await expect(frame).toHaveCSS('width', '560px')
  await page.getByRole('button', { name: 'Close About BrowserOS' }).click()
})

test('mobile minimize/restore retains reachable controls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  const minimize = page.getByRole('button', {
    name: 'Minimize About BrowserOS',
  })
  await expect(minimize).toBeInViewport()
  await minimize.click()
  await expect(
    page.getByRole('region', { name: 'About BrowserOS window' }),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'About BrowserOS (minimized)' })
    .click()
  await expect(
    page.getByRole('button', { name: 'Close About BrowserOS' }),
  ).toBeInViewport()
})

test('keeps four titlebar controls inside the minimum-width window', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  const frame = page.getByRole('region', { name: 'About BrowserOS window' })
  const edge = frame.locator('[data-resize-edge="se"]')
  const handle = (await edge.boundingBox())!
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(0, 0)
  await page.mouse.up()
  await expect(frame).toHaveCSS('width', '280px')
  const bounds = (await frame.boundingBox())!
  for (const label of [
    'Window actions for About BrowserOS',
    'Minimize About BrowserOS',
    'Maximize About BrowserOS',
    'Close About BrowserOS',
  ]) {
    const control = page.getByRole('button', { name: label })
    const box = (await control.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(32)
    expect(box.x).toBeGreaterThanOrEqual(bounds.x)
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width)
  }
  await page.getByRole('button', { name: 'Minimize About BrowserOS' }).click()
  await page
    .getByRole('button', { name: 'About BrowserOS (minimized)' })
    .click()
  await expect(frame).toHaveCSS('width', '280px')
})
