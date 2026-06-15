import { expect, test } from '@playwright/test'

async function setup(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  const frame = page.getByRole('region', { name: 'About BrowserOS window' })
  await expect(frame).toBeVisible()
  return frame
}

test('drags within the workspace, cancels with Escape, and keeps controls clickable', async ({
  page,
}) => {
  const frame = await setup(page)
  const before = (await frame.boundingBox())!
  await page.mouse.move(before.x + 160, before.y + 24)
  await page.mouse.down()
  await page.mouse.move(before.x + 260, before.y + 84, { steps: 12 })
  await page.mouse.up()
  await expect(frame).toHaveCSS('left', '124px')
  await expect(frame).toHaveCSS('top', '84px')
  const moved = (await frame.boundingBox())!
  await page.mouse.move(moved.x + 150, moved.y + 24)
  await page.mouse.down()
  await page.mouse.move(moved.x + 250, moved.y + 120)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(frame).toHaveCSS('left', '124px')
  await expect(frame).toHaveCSS('top', '84px')
  await page.mouse.move(moved.x + 150, moved.y + 24)
  await page.mouse.down()
  await page.mouse.move(-200, -200, { steps: 4 })
  await page.mouse.up()
  await expect(frame).toHaveCSS('left', '0px')
  await expect(frame).toHaveCSS('top', '0px')
  await page.getByRole('button', { name: 'Close About BrowserOS' }).click()
  await expect(frame).toHaveCount(0)
})

test('offers keyboard move, cancellation and native modal focus containment', async ({
  page,
}) => {
  const frame = await setup(page)
  const actions = page.getByRole('button', {
    name: 'Window actions for About BrowserOS',
  })
  await actions.focus()
  await page.keyboard.press('ArrowDown')
  const item = page.getByRole('menuitem', { name: 'Move window' })
  await expect(item).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(actions).toBeFocused()
  await actions.click()
  await item.click()
  const dialog = page.getByRole('dialog', { name: 'Move About BrowserOS' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Apply', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(frame).toHaveCSS('left', '34px')
  await expect(frame).toHaveCSS('top', '64px')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(frame).toHaveCSS('left', '24px')
  await expect(actions).toBeFocused()
  await actions.click()
  await item.click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(frame).toHaveCSS('left', '34px')
  await expect(actions).toBeFocused()
  await actions.click()
  await item.click()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Open About BrowserOS' }),
  ).not.toBeFocused()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Close About BrowserOS' }).click()
})

test('cancels capture loss and resize, then allows another gesture', async ({
  page,
}) => {
  const frame = await setup(page)
  const box = (await frame.boundingBox())!
  await page.mouse.move(box.x + 150, box.y + 24)
  await page.mouse.down()
  await page.mouse.move(box.x + 250, box.y + 100)
  await frame
    .locator('header')
    .evaluate((header) => header.releasePointerCapture(1))
  await page.mouse.up()
  await expect(frame).toHaveCSS('left', '24px')
  await page.mouse.move(box.x + 150, box.y + 24)
  await page.mouse.down()
  await page.mouse.move(box.x + 250, box.y + 100)
  await page.setViewportSize({ width: 900, height: 700 })
  await page.mouse.up()
  await expect(frame).toHaveCSS('left', '24px')
  await page.mouse.move(box.x + 150, box.y + 24)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 54)
  await page.mouse.up()
  await expect(frame).toHaveCSS('left', '74px')
})

test('cancels pointercancel and releases resources when a dragging window closes', async ({
  page,
}) => {
  let frame = await setup(page)
  let box = (await frame.boundingBox())!
  await page.mouse.move(box.x + 150, box.y + 24)
  await page.mouse.down()
  await page.mouse.move(box.x + 220, box.y + 80)
  await frame.locator('header').dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect(frame).toHaveCSS('left', '24px')
  for (let i = 0; i < 3; i++) {
    box = (await frame.boundingBox())!
    await page.mouse.move(box.x + 150, box.y + 24)
    await page.mouse.down()
    await page.mouse.move(box.x + 210, box.y + 80)
    // Programmatic close deliberately covers unmount while the pointer is captured.
    await page
      .getByRole('button', { name: 'Close About BrowserOS' })
      .evaluate((button) => button.click())
    await page.mouse.up()
    await expect(frame).toHaveCount(0)
    await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
    frame = page.getByRole('region', { name: 'About BrowserOS window' })
    await expect(frame).toHaveCSS('left', '24px')
  }
  box = (await frame.boundingBox())!
  await page.mouse.move(box.x + 150, box.y + 24)
  await page.mouse.down()
  await page.mouse.move(box.x + 190, box.y + 54)
  await page.mouse.up()
  await expect(frame).toHaveCSS('left', '64px')
})
