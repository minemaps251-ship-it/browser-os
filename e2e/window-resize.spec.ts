import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
  const frame = page.getByRole('region', { name: 'About BrowserOS window' })
  await expect(frame).toBeVisible()
  return frame
}

for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
  test(`resizes ${edge} with the opposite edge anchored`, async ({ page }) => {
    const frame = await setup(page)
    const handle = frame.locator(`[data-resize-edge="${edge}"]`)
    const box = (await handle.boundingBox())!
    const dx = edge.includes('w') ? -20 : edge.includes('e') ? 30 : 0
    const dy = edge.includes('n') ? -20 : edge.includes('s') ? 30 : 0
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      box.x + box.width / 2 + dx,
      box.y + box.height / 2 + dy,
      { steps: 5 },
    )
    await page.mouse.up()
    await expect(frame).toHaveCSS('left', edge.includes('w') ? '4px' : '24px')
    await expect(frame).toHaveCSS('top', edge.includes('n') ? '4px' : '24px')
    await expect(frame).toHaveCSS(
      'width',
      `${560 + (edge.includes('w') ? 20 : edge.includes('e') ? 30 : 0)}px`,
    )
    await expect(frame).toHaveCSS(
      'height',
      `${440 + (edge.includes('n') ? 20 : edge.includes('s') ? 30 : 0)}px`,
    )
    await expect(
      page.getByText('A desktop, built for the browser.'),
    ).toBeVisible()
  })
}

test('constrains minimum/maximum, rolls back cancellation, and survives close during resize', async ({
  page,
}) => {
  let frame = await setup(page)
  let handle = frame.locator('[data-resize-edge="se"]')
  let box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(0, 0, { steps: 5 })
  await page.mouse.up()
  await expect(frame).toHaveCSS('width', '280px')
  await expect(frame).toHaveCSS('height', '240px')
  await page
    .getByText(
      'This is the first working slice. Files and persistent storage will follow.',
    )
    .scrollIntoViewIfNeeded()
  await expect(
    page.getByRole('button', { name: 'Close About BrowserOS' }),
  ).toBeInViewport()
  box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + 100)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(frame).toHaveCSS('width', '280px')
  box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(2000, 2000, { steps: 5 })
  await page.mouse.up()
  const workspace = (await page.locator('#desktop-workspace').boundingBox())!
  const resized = (await frame.boundingBox())!
  expect(resized.x + resized.width).toBeLessThanOrEqual(
    workspace.x + workspace.width + 1,
  )
  expect(resized.y + resized.height).toBeLessThanOrEqual(
    workspace.y + workspace.height + 1,
  )
  for (let i = 0; i < 3; i++) {
    handle = frame.locator('[data-resize-edge="nw"]')
    box = (await handle.boundingBox())!
    await page.mouse.move(box.x + 10, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + 30, box.y + 30)
    await page
      .getByRole('button', { name: 'Close About BrowserOS' })
      .evaluate((button) => button.click())
    await page.mouse.up()
    await expect(frame).toHaveCount(0)
    await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
    frame = page.getByRole('region', { name: 'About BrowserOS window' })
    await expect(frame).toHaveCSS('width', '560px')
  }
})

test('supports roving menu navigation and keyboard resize with focus return', async ({
  page,
}) => {
  const frame = await setup(page)
  const actions = page.getByRole('button', {
    name: 'Window actions for About BrowserOS',
  })
  await actions.focus()
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('menuitem', { name: 'Move window' }),
  ).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('menuitem', { name: 'Resize window' }),
  ).toBeFocused()
  await page.keyboard.press('Home')
  await expect(
    page.getByRole('menuitem', { name: 'Move window' }),
  ).toBeFocused()
  await page.keyboard.press('End')
  await expect(
    page.getByRole('menuitem', { name: 'Maximize window' }),
  ).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Resize About BrowserOS' })
  await expect(
    dialog.getByRole('button', { name: 'Apply', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(frame).toHaveCSS('width', '570px')
  await expect(frame).toHaveCSS('height', '480px')
  await page.keyboard.press('Escape')
  await expect(frame).toHaveCSS('width', '560px')
  await expect(actions).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(
    page.getByRole('menuitem', { name: 'Maximize window' }),
  ).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(
    page.getByRole('menuitem', { name: 'Resize window' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(frame).toHaveCSS('width', '570px')
  await expect(actions).toBeFocused()
})

test('cancels capture loss/viewport changes and hides handles in mobile fallback', async ({
  page,
}) => {
  const frame = await setup(page)
  const handle = frame.locator('[data-resize-edge="se"]')
  let box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 50, box.y + 30)
  await handle.evaluate((element) => element.releasePointerCapture(1))
  await page.mouse.up()
  await expect(frame).toHaveCSS('width', '560px')
  box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 50, box.y + 30)
  await handle.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect(frame).toHaveCSS('width', '560px')
  box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 50, box.y + 30)
  await page.setViewportSize({ width: 375, height: 667 })
  await page.mouse.up()
  await expect(handle).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Close About BrowserOS' }),
  ).toBeInViewport()
  await page.setViewportSize({ width: 1000, height: 800 })
  await expect(handle).toBeVisible()
  box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 40, box.y + 30)
  await page.mouse.up()
  await expect(frame).toHaveCSS('width', '385px')
})

test('keeps titlebar controls reachable with coarse-pointer hit areas', async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 800 },
    hasTouch: true,
  })
  try {
    const frame = await setup(page)
    await expect(frame.locator('[data-resize-edge="n"]')).toHaveCSS(
      'height',
      '24px',
    )
    await page
      .getByRole('button', { name: 'Window actions for About BrowserOS' })
      .tap({ position: { x: 2, y: 2 } })
    await expect(
      page.getByRole('menuitem', { name: 'Resize window' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await page
      .getByRole('button', { name: 'Close About BrowserOS' })
      .tap({ position: { x: 2, y: 2 } })
    await expect(frame).toHaveCount(0)
  } finally {
    await page.close()
  }
})
