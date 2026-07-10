import { expect, test } from '@playwright/test'

for (const target of [
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'maximize',
]) {
  test(`previews and commits ${target}, restores by dragging and cancels without losing placement`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Open About BrowserOS' }).click()
    const frame = page.getByRole('region', { name: 'About BrowserOS window' })
    await expect(frame).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Window actions for About BrowserOS' }),
    ).toHaveCount(0)
    const original = (await frame.boundingBox())!
    const workspace = (await page.locator('#desktop-workspace').boundingBox())!
    const x =
      target === 'maximize'
        ? workspace.x + workspace.width / 2
        : target.endsWith('right')
          ? workspace.x + workspace.width - 1
          : workspace.x + 1
    const y = target.startsWith('bottom')
      ? workspace.y + workspace.height - 1
      : target.startsWith('top') || target === 'maximize'
        ? workspace.y + 1
        : workspace.y + workspace.height / 2
    await page.mouse.move(original.x + 160, original.y + 24)
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 8 })
    const preview = page.locator('[data-snap-preview]')
    await expect(preview).toBeVisible()
    const halfWidth = workspace.width / 2
    const halfHeight = workspace.height / 2
    const expected = {
      x: workspace.x + (target.endsWith('right') ? halfWidth : 0),
      y: workspace.y + (target.startsWith('bottom') ? halfHeight : 0),
      width: target === 'maximize' ? workspace.width : halfWidth,
      height: target.includes('-') ? halfHeight : workspace.height,
    }
    await expect.poll(() => preview.boundingBox()).toEqual(expected)
    await page.mouse.up()
    await expect(preview).toHaveCount(0)
    await expect(frame).toHaveAttribute(
      'data-placement',
      target === 'maximize' ? 'maximized' : 'tiled',
    )
    expect(await frame.boundingBox()).toEqual(expected)
    // Escape restores both geometry and placement without committing a detached draft.
    let tiled = (await frame.boundingBox())!
    await page.mouse.move(tiled.x + 160, tiled.y + 24)
    await page.mouse.down()
    await page.mouse.move(workspace.x + 400, workspace.y + 220, { steps: 8 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await frame.boundingBox()).toEqual(tiled)
    await page.mouse.move(tiled.x + 160, tiled.y + 24)
    await page.mouse.down()
    await page.mouse.move(workspace.x + 450, workspace.y + 240, { steps: 8 })
    await page.mouse.up()
    await expect(frame).toHaveAttribute('data-placement', 'normal')
    tiled = (await frame.boundingBox())!
    expect(tiled.width).toBe(original.width)
    expect(tiled.height).toBe(original.height)
    expect(450 + workspace.x).toBeGreaterThan(tiled.x)
    expect(450 + workspace.x).toBeLessThan(tiled.x + tiled.width)
    await frame.locator('header h2').dblclick()
    await expect(frame).toHaveAttribute('data-maximized', 'true')
    await frame.locator('header h2').dblclick()
    await expect(frame).toHaveAttribute('data-placement', 'normal')
    expect(await frame.boundingBox()).toEqual(tiled)
  })
}
