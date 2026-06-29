import { expect, test, type Locator } from '@playwright/test'
async function command(frame: Locator, text: string) {
  const input = frame.getByRole('textbox', { name: 'Command' })
  await expect(input).not.toHaveAttribute('readonly', '')
  await input.fill(text)
  await input.press('Enter')
  await expect(frame.getByRole('log')).toContainText(`$ ${text}`)
  await expect(input).not.toHaveAttribute('readonly', '')
}
test('Terminal reads Files changes, retains stable cwd after rename and sees durable files after reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'Open folder Documents' }).click()
  await expect(files.getByRole('button', { name: 'New file' })).toBeEnabled()
  await files.getByRole('button', { name: 'New file' }).click()
  const dialog = page.getByRole('dialog', { name: 'New file' })
  await dialog.getByRole('textbox').fill('read me.txt')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  await command(terminal, 'pwd')
  await expect(terminal.getByRole('log')).toContainText('/home/user')
  await command(terminal, 'cd Documents')
  await command(terminal, 'ls')
  await expect(terminal.getByRole('log')).toContainText('read me.txt')
  await page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'Files', exact: true })
    .click()
  await files.getByRole('button', { name: 'Up', exact: true }).click()
  await files.getByRole('button', { name: 'Select folder Documents' }).click()
  await files.getByRole('button', { name: 'Rename', exact: true }).click()
  await files.getByRole('textbox', { name: 'Rename Documents' }).fill('Work')
  await files.getByRole('button', { name: 'Save name' }).click()
  await expect(
    terminal.getByText('/home/user/Work', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'Terminal', exact: true })
    .click()
  await command(terminal, 'pwd')
  await expect(terminal.getByRole('log')).toContainText('/home/user/Work')
  await page.reload()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  await expect(terminal.getByRole('log')).toBeEmpty()
  await command(terminal, 'ls Work')
  await expect(terminal.getByRole('log')).toContainText('read me.txt')
})
test('Terminal windows navigate independently, report errors and restore from Dock', async ({
  page,
}) => {
  await page.goto('/')
  const launcher = page.getByRole('button', {
    name: 'Open Terminal',
    exact: true,
  })
  await launcher.click()
  const frames = page.getByRole('region', { name: 'Terminal window' })
  await command(frames.first(), 'cd Documents')
  await launcher.click()
  await expect(frames).toHaveCount(2)
  await command(frames.nth(1), 'pwd')
  await expect(
    frames
      .nth(1)
      .getByRole('paragraph')
      .filter({ hasText: /^\/home\/user$/ }),
  ).toBeVisible()
  await expect(
    frames.first().getByText('/home/user/Documents', { exact: true }),
  ).toBeVisible()
  await command(frames.nth(1), 'cd missing')
  await expect(frames.nth(1).getByRole('log')).toContainText(
    'No such file or folder',
  )
  await command(frames.nth(1), 'ls | pwd')
  await expect(frames.nth(1).getByRole('log')).toContainText('Shell operators')
  await frames
    .nth(1)
    .getByRole('button', { name: 'Minimize Terminal', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'Terminal', exact: true })
    .click()
  await expect(frames).toHaveCount(2)
})
test('Terminal input, output and controls remain reachable on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const frame = page.getByRole('region', { name: 'Terminal window' })
  await expect(frame.getByRole('textbox')).toBeInViewport()
  await command(frame, 'help')
  await expect(frame.getByRole('log')).toContainText('ls [path]')
  await frame.getByRole('textbox').scrollIntoViewIfNeeded()
  await expect(frame.getByRole('textbox')).toBeInViewport()
  await expect(
    frame.getByRole('button', { name: 'Close Terminal', exact: true }),
  ).toBeInViewport()
})

test('mkdir and touch update Files and persist a single file after concurrent touches and reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'Open folder Documents' }).click()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  await command(terminal, 'mkdir "Documents/My folder"')
  await expect(
    files.getByRole('button', { name: 'Open folder My folder' }),
  ).toBeVisible()
  await command(terminal, 'touch "Documents/My folder/note.txt"')
  await command(terminal, 'touch "Documents/My folder/note.txt"')
  await command(terminal, 'ls "Documents/My folder"')
  await expect(terminal.getByRole('log')).toContainText('note.txt')
  await command(terminal, 'mkdir Documents')
  await expect(terminal.getByRole('log')).toContainText('already exists')
  await command(terminal, 'touch /system/blocked.txt')
  await expect(terminal.getByRole('log')).toContainText('protected')
  await page
    .getByRole('navigation', { name: 'Running applications' })
    .getByRole('button', { name: 'Files', exact: true })
    .click()
  await files.getByRole('button', { name: 'Open folder My folder' }).click()
  await expect(
    files.getByRole('button', { name: 'Select file note.txt' }),
  ).toHaveCount(1)
  await page.reload()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  await files.getByRole('button', { name: 'Open folder Documents' }).click()
  await files.getByRole('button', { name: 'Open folder My folder' }).click()
  await expect(
    files.getByRole('button', { name: 'Select file note.txt' }),
  ).toHaveCount(1)
})

// Browser-only test records; each Playwright context has an isolated browser-os database.
interface OutputRequest<T> {
  result: T
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}
interface OutputDatabase {
  close(): void
  transaction(
    names: string[],
    mode: 'readwrite',
  ): {
    error: unknown
    oncomplete: (() => void) | null
    onabort: (() => void) | null
    objectStore(name: string): {
      getAll(): OutputRequest<unknown[]>
      get(key: string): OutputRequest<unknown>
      put(value: unknown): unknown
    }
  }
}
declare const indexedDB: { open(name: string): OutputRequest<OutputDatabase> }
test('cat reads persisted text after reload and echo remains literal; clear preserves cwd', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  await command(terminal, 'touch "Documents/read me.txt"')
  await page.evaluate(async () => {
    const request = indexedDB.open('browser-os')
    const database = await new Promise<OutputDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const tx = database.transaction(
        ['nodes', 'contents', 'meta'],
        'readwrite',
      )
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
      })
      const nodes = tx.objectStore('nodes').getAll(),
        totals = tx.objectStore('meta').get('totals')
      const read = <T>(request: OutputRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      const [raw, rawTotals] = await Promise.all([read(nodes), read(totals)])
      const records = raw as {
        id: string
        name: string
        contentId: string
        byteLength: number
        metadataRevision: number
        contentRevision: number
      }[]
      const node = records.find((node) => node.name === 'read me.txt')!
      const counter = rawTotals as {
        key: string
        nodeCount: number
        textBytes: number
      }
      const text = 'Hello from persistent VFS\n<script>unsafe()</script>'
      const byteLength = text.length // ASCII fixture.
      tx.objectStore('nodes').put({
        ...node,
        byteLength,
        updatedAt: Date.now(),
        metadataRevision: node.metadataRevision + 1,
        contentRevision: node.contentRevision + 1,
      })
      tx.objectStore('contents').put({
        id: node.contentId,
        content: { kind: 'text', encoding: 'utf-8', text },
      })
      tx.objectStore('meta').put({
        ...counter,
        textBytes: counter.textBytes + byteLength - node.byteLength,
      })
      await done
    } finally {
      database.close()
    }
  })
  await page.reload()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  await command(terminal, 'cd Documents')
  await command(terminal, 'cat "read me.txt"')
  await expect(terminal.getByRole('log')).toContainText(
    'Hello from persistent VFS',
  )
  await expect(terminal.getByRole('log')).toContainText(
    '<script>unsafe()</script>',
  )
  await expect(terminal.getByRole('log').locator('script')).toHaveCount(0)
  await command(terminal, 'echo "literal > output.txt"')
  await expect(terminal.getByRole('log')).toContainText('literal > output.txt')
  await command(terminal, 'echo rejected > output.txt')
  await expect(terminal.getByRole('log')).toContainText('Shell operators')
  await command(terminal, 'ls')
  await expect(
    terminal.getByRole('log').locator('pre').last(),
  ).not.toContainText('output.txt')
  const input = terminal.getByRole('textbox', { name: 'Command' })
  await input.fill('clear')
  await input.press('Enter')
  await expect(terminal.getByRole('log')).toBeEmpty()
  await expect(input).not.toHaveAttribute('readonly', '')
  await expect(
    terminal.getByText('/home/user/Documents', { exact: true }),
  ).toBeVisible()
  await command(terminal, 'cat "read me.txt"')
  await expect(terminal.getByRole('log')).toContainText(
    'Hello from persistent VFS',
  )
})

test('cp and mv update Files, reject overwrite and retain moved folders after reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'Open folder Documents' }).click()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  const terminal = page.getByRole('region', { name: 'Terminal window' })
  await command(terminal, 'touch "Documents/source file.txt"')
  await command(
    terminal,
    'cp "Documents/source file.txt" "Documents/copy file.txt"',
  )
  await expect(
    files.getByRole('button', { name: 'Select file copy file.txt' }),
  ).toBeVisible()
  await command(
    terminal,
    'mv "Documents/copy file.txt" "Documents/source file.txt"',
  )
  await expect(terminal.getByRole('log')).toContainText(
    'overwrite is not supported',
  )
  await command(terminal, 'mkdir Documents/work')
  await command(terminal, 'mv "Documents/copy file.txt" Documents/work/')
  await expect(
    files.getByRole('button', { name: 'Select file copy file.txt' }),
  ).toHaveCount(0)
  await command(terminal, 'mv Documents/work Desktop/renamed')
  await expect(
    files.getByRole('button', { name: 'Open folder work' }),
  ).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  await files.getByRole('button', { name: 'Open folder Desktop' }).click()
  await files.getByRole('button', { name: 'Open folder renamed' }).click()
  await expect(
    files.getByRole('button', { name: 'Select file copy file.txt' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Open Terminal', exact: true }).click()
  await command(terminal, 'ls Documents')
  await expect(terminal.getByRole('log').locator('pre').last()).toContainText(
    'source file.txt',
  )
  await command(terminal, 'ls Desktop/renamed')
  await expect(terminal.getByRole('log').locator('pre').last()).toContainText(
    'copy file.txt',
  )
})

test('rm requires recursion, updates Files and recovers another Terminal cwd durably', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  const files = page.getByRole('region', { name: 'Files window' })
  await files.getByRole('button', { name: 'Open folder Documents' }).click()
  const launcher = page.getByRole('button', {
    name: 'Open Terminal',
    exact: true,
  })
  await launcher.click()
  const frames = page.getByRole('region', { name: 'Terminal window' })
  await command(frames.first(), 'mkdir "Documents/remove me"')
  await command(frames.first(), 'touch "Documents/remove me/keep.txt"')
  await command(frames.first(), 'touch Documents/survivor.txt')
  await command(frames.first(), 'touch Documents/disposable.txt')
  await command(frames.first(), 'rm Documents/disposable.txt')
  await expect(
    files.getByRole('button', { name: 'Select file disposable.txt' }),
  ).toHaveCount(0)
  await command(frames.first(), 'cd "Documents/remove me"')
  await launcher.click()
  await expect(frames).toHaveCount(2)
  await command(frames.nth(1), 'rm "Documents/remove me"')
  await expect(frames.nth(1).getByRole('log')).toContainText(
    'Folder is not empty',
  )
  await expect(
    files.getByRole('button', { name: 'Open folder remove me' }),
  ).toBeVisible()
  await command(frames.nth(1), 'ls "Documents/remove me"')
  await expect(
    frames.nth(1).getByRole('log').locator('pre').last(),
  ).toContainText('keep.txt')
  await command(frames.nth(1), 'rm -r "Documents/remove me"')
  await expect(
    files.getByRole('button', { name: 'Open folder remove me' }),
  ).toHaveCount(0)
  await expect(
    frames
      .first()
      .getByRole('paragraph')
      .filter({ hasText: /^\/home\/user$/ }),
  ).toBeVisible()
  await expect(
    frames
      .first()
      .getByRole('status')
      .filter({ hasText: 'current folder was removed' }),
  ).toBeVisible()
  await command(frames.nth(1), 'rm -r /system')
  await expect(frames.nth(1).getByRole('log')).toContainText('protected')
  await page.reload()
  await page.getByRole('button', { name: 'Open Files', exact: true }).click()
  await files.getByRole('button', { name: 'Open folder Documents' }).click()
  await expect(
    files.getByRole('button', { name: 'Select file survivor.txt' }),
  ).toBeVisible()
  await expect(
    files.getByRole('button', { name: 'Open folder remove me' }),
  ).toHaveCount(0)
  await expect(
    files.getByRole('button', { name: 'Select file disposable.txt' }),
  ).toHaveCount(0)
})

test('history recalls without execution, restores drafts and stays local to each window', async ({
  page,
}) => {
  await page.goto('/')
  const launcher = page.getByRole('button', {
    name: 'Open Terminal',
    exact: true,
  })
  await launcher.click()
  const frames = page.getByRole('region', { name: 'Terminal window' })
  const input = frames.first().getByRole('textbox', { name: 'Command' })
  await command(frames.first(), 'echo first')
  await command(frames.first(), 'pwd')
  await input.fill('unfinished draft')
  await input.press('ArrowUp')
  await expect(input).toHaveValue('pwd')
  await input.press('ArrowUp')
  await expect(input).toHaveValue('echo first')
  await input.press('ArrowDown')
  await input.press('ArrowDown')
  await expect(input).toHaveValue('unfinished draft')
  await expect(frames.first().getByRole('log').locator('pre')).toHaveCount(2)
  await input.fill('clear')
  await input.press('Enter')
  await expect(frames.first().getByRole('log')).toBeEmpty()
  await expect(input).not.toHaveAttribute('readonly', '')
  await input.press('ArrowUp')
  await expect(input).toHaveValue('clear')
  await input.press('ArrowUp')
  await expect(input).toHaveValue('pwd')
  await expect(frames.first().getByRole('log')).toBeEmpty()
  await launcher.click()
  const other = frames.nth(1).getByRole('textbox', { name: 'Command' })
  await expect(other).not.toHaveAttribute('readonly', '')
  await other.fill('second draft')
  await other.press('ArrowUp')
  await expect(other).toHaveValue('second draft')
  await expect(input).toHaveValue('pwd')
  await page.reload()
  await launcher.click()
  const fresh = frames.first().getByRole('textbox', { name: 'Command' })
  await expect(fresh).not.toHaveAttribute('readonly', '')
  await fresh.press('ArrowUp')
  await expect(fresh).toHaveValue('')
})
