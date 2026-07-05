import { expect, test, type Locator, type Page } from '@playwright/test'
async function editorFixture(page: Page) {
  await page.goto('/')
  return openEditor(page)
}
async function contrast(
  element: Locator,
  background?: Locator,
  foreground: 'color' | 'borderTopColor' | 'outlineColor' = 'color',
) {
  const colors = await element.evaluate((element, foreground) => {
    const style = getComputedStyle(element)
    return { foreground: style[foreground], background: style.backgroundColor }
  }, foreground)
  if (background)
    colors.background = await background.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
  const luminance = (color: string) => {
    const rgb = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4
      })
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const a = luminance(colors.foreground),
    b = luminance(colors.background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
test('Editor uses window height, keeps history through maximize/theme and scrolls long code internally', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const { editor, code } = await editorFixture(page)
  const scroller = editor.locator('.cm-scroller')
  await expect
    .poll(async () => {
      const frame = await editor.boundingBox(),
        area = await scroller.boundingBox()
      return area!.height / frame!.height
    })
    .toBeGreaterThan(0.48)
  await code.fill('first draft')
  await code.press('ControlOrMeta+End')
  await page.keyboard.type(' edited')
  await editor
    .getByRole('button', { name: 'Maximize Code Editor', exact: true })
    .click()
  await expect
    .poll(async () => (await scroller.boundingBox())!.height)
    .toBeGreaterThan(400)
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('dark')
  await code.press('ControlOrMeta+z')
  await expect(code).toHaveText('first draft')
  await code.fill(
    Array.from({ length: 120 }, (_, i) => `line ${i}: ${'x'.repeat(140)}`).join(
      '\n',
    ),
  )
  await code.press('ControlOrMeta+End')
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  expect(
    await editor.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true)
  await code.press('Tab')
  await expect(code).not.toBeFocused()
})
test('narrow search and replace controls remain keyboard reachable without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const { editor, code } = await editorFixture(page)
  await code.fill('first answer\nsecond answer')
  await code.press('ControlOrMeta+f')
  const search = editor.locator('.cm-search')
  const find = search.getByRole('textbox', { name: 'Find', exact: true })
  await find.fill('')
  await find.pressSequentially('answer')
  const replace = search.getByRole('textbox', { name: 'Replace', exact: true })
  await replace.pressSequentially('result')
  const controls = search.locator('input, button')
  for (let i = 0; i < (await controls.count()); i++) {
    await controls.nth(i).focus()
    await expect(controls.nth(i)).toBeFocused()
    await expect(controls.nth(i)).toBeInViewport()
  }
  await search.getByRole('button', { name: 'replace all', exact: true }).click()
  await expect(code.locator('.cm-line')).toHaveText([
    'first result',
    'second result',
  ])
  expect(
    await editor.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true)
  await find.press('Escape')
  await expect(search).toHaveCount(0)
  await expect(code).toBeFocused()
  await code.press('ControlOrMeta+z')
  await expect(code.locator('.cm-line')).toHaveText([
    'first answer',
    'second answer',
  ])
  await code.press('ControlOrMeta+f')
  const closeSearch = editor
    .locator('.cm-search')
    .getByRole('button', { name: 'close', exact: true })
  await closeSearch.focus()
  await expect(closeSearch).toBeInViewport()
  expect((await closeSearch.boundingBox())!.width).toBeGreaterThanOrEqual(44)
  await closeSearch.click()
  await expect(editor.locator('.cm-search')).toHaveCount(0)
  await expect(code).toBeFocused()
})
for (const theme of ['light', 'dark']) {
  test(`${theme} app controls, selected files and search text have readable contrast`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Appearance' }).selectOption(theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.getByRole('button', { name: 'Open Files', exact: true }).click()
    const files = page.getByRole('region', { name: 'Files window' })
    expect(
      await contrast(
        files.getByRole('button', { name: 'New file', exact: true }),
      ),
    ).toBeGreaterThanOrEqual(4.5)
    const newFile = files.getByRole('button', { name: 'New file', exact: true })
    expect(
      await contrast(newFile, undefined, 'borderTopColor'),
    ).toBeGreaterThanOrEqual(3)
    await newFile.hover()
    expect(
      await contrast(newFile, undefined, 'borderTopColor'),
    ).toBeGreaterThanOrEqual(3)
    await files.getByRole('button', { name: 'New file', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New file' })
    await dialog.getByRole('textbox', { name: 'Name' }).fill('polish.txt')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden()
    const selected = files.getByRole('button', {
      name: 'Select file polish.txt',
      exact: true,
    })
    await expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(await contrast(selected)).toBeGreaterThanOrEqual(4.5)
    await files
      .getByRole('button', { name: 'Close Files', exact: true })
      .click()
    await page.getByRole('button', { name: 'Open Notes', exact: true }).click()
    const notes = page.getByRole('region', { name: 'Notes window' })
    const text = notes.getByRole('textbox', { name: 'Text' })
    expect(await contrast(text)).toBeGreaterThanOrEqual(4.5)
    const initialHeight = (await text.boundingBox())!.height
    await notes
      .getByRole('button', { name: 'Maximize Notes', exact: true })
      .click()
    await expect
      .poll(async () => (await text.boundingBox())!.height)
      .toBeGreaterThan(initialHeight + 50)
    await notes
      .getByRole('button', { name: 'Close Notes', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Open Terminal', exact: true })
      .click()
    const terminal = page.getByRole('region', { name: 'Terminal window' })
    const command = terminal.getByRole('textbox', { name: 'Command' })
    expect(await contrast(command)).toBeGreaterThanOrEqual(4.5)
    await terminal
      .getByRole('button', { name: 'Close Terminal', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Open Settings', exact: true })
      .click()
    const settings = page.getByRole('region', { name: 'Settings window' })
    const selectedTheme = settings.getByRole('radio', {
      name: theme === 'light' ? 'Light' : 'Dark',
      exact: true,
    })
    await expect(selectedTheme).toBeChecked()
    expect(await contrast(selectedTheme.locator('..'))).toBeGreaterThanOrEqual(
      4.5,
    )
    await settings
      .getByRole('button', { name: 'Close Settings', exact: true })
      .click()
    const { editor, code } = await openEditor(page)
    await code.fill('readable answer')
    await code.press('ControlOrMeta+f')
    const find = editor.getByRole('textbox', { name: 'Find', exact: true })
    await find.fill('')
    await find.pressSequentially('answer')
    const match = code.locator('.cm-searchMatch')
    await expect(match).toHaveCount(1)
    expect(await contrast(match)).toBeGreaterThanOrEqual(4.5)
    const tab = editor.getByRole('tab')
    expect(await contrast(tab)).toBeGreaterThanOrEqual(4.5)
    await find.press('Escape')
    await code.focus()
    expect(
      await contrast(
        editor.locator('.cm-editor').locator('..'),
        editor.locator('.cm-editor'),
        'outlineColor',
      ),
    ).toBeGreaterThanOrEqual(3)
    expect(
      await editor
        .locator('.cm-editor')
        .evaluate(
          (element) => getComputedStyle(element.parentElement!).outlineStyle,
        ),
    ).toBe('solid')
  })
}
async function openEditor(page: Page) {
  await page
    .getByRole('button', { name: 'Open Code Editor', exact: true })
    .click()
  const editor = page.getByRole('region', { name: 'Code Editor window' })
  const code = editor.locator('.cm-content[contenteditable="true"]')
  await expect(code).toBeVisible()
  return { editor, code }
}
test('reduced motion and narrow layout retain keyboard focus and large targets', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 375, height: 667 })
  const { editor, code } = await editorFixture(page)
  const newTab = editor.getByRole('button', { name: 'New tab', exact: true })
  expect((await newTab.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await newTab.focus()
  await expect(newTab).toBeFocused()
  expect(
    await newTab.evaluate((element) =>
      parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ).toBeLessThan(0.001)
  await code.focus()
  await code.press('Tab')
  await expect(code).not.toBeFocused()
})
