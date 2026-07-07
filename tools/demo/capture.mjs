import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile } from 'node:fs/promises'

const origin = 'http://127.0.0.1:4176'
const output = 'assets/screenshots'
const welcome = await readFile('examples/demo/welcome.txt', 'utf8')
const source = await readFile('examples/demo/example.ts', 'utf8')
await mkdir(output, { recursive: true })
let ready = false
let serverOutput = ''
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4176',
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
server.stdout.on('data', (data) => {
  serverOutput = (serverOutput + data).slice(-4000)
  if (serverOutput.includes(origin)) ready = true
})
server.stderr.on('data', (data) => {
  serverOutput = (serverOutput + data).slice(-4000)
})
let spawnError
server.on('error', (error) => {
  spawnError = error
})
let browser
try {
  for (let attempt = 0; !ready; attempt++) {
    if (spawnError) throw spawnError
    if (server.exitCode !== null || attempt >= 100)
      throw new Error(`Preview failed: ${serverOutput}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin)
  await expect(
    page.getByRole('heading', { name: 'BrowserOS', exact: true }),
  ).toBeVisible()
  const appearance = page.getByRole('combobox', { name: 'Appearance' })
  async function theme(value) {
    await appearance.selectOption(value)
    await expect(page.locator('html')).toHaveAttribute('data-theme', value)
  }
  async function screenshot(name) {
    await page.screenshot({
      path: `${output}/${name}.png`,
      animations: 'disabled',
    })
  }
  async function open(name) {
    const launcher = page.getByRole('button', {
      name: `Open ${name}`,
      exact: true,
    })
    await launcher.focus()
    await launcher.press('Enter')
    const frame = page.getByRole('region', {
      name: `${name} window`,
      exact: true,
    })
    await expect(frame).toBeVisible()
    return frame
  }
  async function close(frame, name) {
    const button = frame.getByRole('button', {
      name: `Close ${name}`,
      exact: true,
    })
    await button.focus()
    await button.press('Enter')
    await expect(frame).toHaveCount(0)
  }
  async function saveAs(name) {
    const dialog = page.getByRole('dialog', { name: 'Save as', exact: true })
    await dialog
      .getByRole('textbox', { name: 'File name', exact: true })
      .fill(name)
    await dialog.getByRole('button', { name: 'Save file', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  // Move real windows through pointer interaction, without changing their CSS/DOM.
  async function move(frame, x, y) {
    const title = await frame.locator(':scope > header h2').boundingBox()
    const bounds = await frame.boundingBox()
    const workspace = await page.locator('#desktop-workspace').boundingBox()
    if (!title || !bounds || !workspace)
      throw new Error('Missing window geometry')
    const fromX = title.x + Math.min(60, title.width / 2)
    const fromY = title.y + title.height / 2
    await page.mouse.move(fromX, fromY)
    await page.mouse.down()
    await page.mouse.move(
      fromX + workspace.x + x - bounds.x,
      fromY + workspace.y + y - bounds.y,
      { steps: 10 },
    )
    await page.mouse.up()
  }
  async function resizeHeight(frame, name, target) {
    const height = (await frame.boundingBox()).height
    const menu = frame.getByRole('button', {
      name: `Window actions for ${name}`,
      exact: true,
    })
    await menu.focus()
    await menu.press('Enter')
    await frame
      .getByRole('menuitem', { name: 'Resize window', exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: `Resize ${name}`,
      exact: true,
    })
    await expect(dialog).toBeVisible()
    for (let step = 0; step < Math.round((height - target) / 10); step++)
      await dialog.getByRole('button', { name: 'Shorter', exact: true }).click()
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  await theme('light')
  await screenshot('desktop-light')
  await theme('dark')
  await screenshot('desktop-dark')
  await theme('light')
  const about = await open('About BrowserOS')
  await screenshot('about-light')
  await close(about, 'About BrowserOS')
  const notes = await open('Notes')
  const text = notes.getByRole('textbox', { name: 'Text', exact: true })
  await expect(text).not.toHaveAttribute('readonly', '')
  await text.fill(welcome)
  await notes.getByRole('button', { name: 'Save', exact: true }).click()
  await saveAs('welcome.txt')
  await close(notes, 'Notes')
  const editor = await open('Code Editor')
  const code = editor.locator('.cm-content[contenteditable="true"]')
  await expect(code).toBeVisible()
  await code.fill(source)
  await code.press('Control+s')
  await saveAs('example.ts')
  await expect(
    editor.getByRole('status').filter({ hasText: /^Saved$/ }),
  ).toBeVisible()
  await close(editor, 'Code Editor')
  // Prove persistence before taking the application screenshots.
  await page.reload()
  const files = await open('Files')
  await files
    .getByRole('button', { name: 'Select file example.ts', exact: true })
    .click()
  await files
    .getByRole('button', { name: 'Open in Code Editor', exact: true })
    .click()
  await expect(editor).toBeVisible()
  await expect(code).toContainText('export type Task')
  await move(editor, 676, 16)
  const terminal = await open('Terminal')
  const command = terminal.getByRole('textbox', {
    name: 'Command',
    exact: true,
  })
  await expect(command).not.toHaveAttribute('readonly', '')
  await command.fill('cat welcome.txt')
  await command.press('Enter')
  await expect(terminal.getByRole('log')).toContainText(
    'One workspace, several ways to work.',
  )
  await resizeHeight(terminal, 'Terminal', 400)
  await move(terminal, 16, 488)
  await move(files, 16, 16)
  await code.focus()
  await theme('light')
  await screenshot('workspace-light')
  await theme('dark')
  await screenshot('workspace-dark')
  await close(terminal, 'Terminal')
  await close(files, 'Files')
  await close(editor, 'Code Editor')
  const settings = await open('Settings')
  await settings
    .getByRole('button', { name: 'Prepare export', exact: true })
    .click()
  const download = settings.getByRole('link', {
    name: 'Download JSON',
    exact: true,
  })
  await expect(download).toBeVisible()
  const received = page.waitForEvent('download')
  await download.click()
  const artifact = await received
  const path = await artifact.path()
  if (!path) throw new Error('Missing download')
  const backup = JSON.parse(await readFile(path, 'utf8'))
  if (
    backup.format !== 'browser-os-workspace' ||
    backup.version !== 1 ||
    backup.settings.theme !== 'dark' ||
    !backup.entries.some(
      (entry) => entry.name === 'welcome.txt' && entry.text === welcome,
    ) ||
    !backup.entries.some(
      (entry) => entry.name === 'example.ts' && entry.text === source,
    )
  )
    throw new Error('Export verification failed')
  await screenshot('export-dark')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    `Captured six real screenshots in ${output}; saved text, reload, Terminal and export verified.`,
  )
} finally {
  try {
    await browser?.close()
  } finally {
    if (server.exitCode === null && !spawnError) {
      const stopped = once(server, 'exit')
      server.kill('SIGTERM')
      await stopped
    }
  }
}
