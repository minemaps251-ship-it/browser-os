import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { chromium, expect } from '@playwright/test'
import { EditorState } from '@codemirror/state'
const root = fileURLToPath(new URL('.', import.meta.url))
const dist = join(root, 'dist')
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
}
const requests = new Set()
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
  if (!path.startsWith(`${dist}/`)) {
    response.writeHead(403)
    response.end()
    return
  }
  try {
    const data = await readFile(path)
    if (pathname.startsWith('/assets/')) requests.add(pathname.slice(1))
    response.writeHead(200, {
      'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    response.end(data)
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const base = `http://127.0.0.1:${address.port}`
let browser
const checks = []
async function sizes(paths) {
  const files = []
  for (const path of [...paths].sort()) {
    const buffer = await readFile(join(dist, path))
    files.push({
      path,
      rawBytes: buffer.length,
      gzipBytes: gzipSync(buffer).length,
    })
  }
  return {
    rawBytes: files.reduce((sum, file) => sum + file.rawBytes, 0),
    gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
    files,
  }
}
async function diagnostics(page) {
  return page.evaluate(async () => {
    let timer
    try {
      return await Promise.race([
        window.spike.diagnostics(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Diagnostic worker timed out')),
            10000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  })
}
try {
  browser = await chromium.launch()
  const results = {
    date: '2026-10-06',
    node: process.version,
    chromium: browser.version(),
    scope:
      'Isolated Vite build, JS/TS editing. Local headless Chromium, no network/CPU throttling. gzip sums are offline estimates, server sends uncompressed assets. Timing includes Playwright overhead. Counters do not prove absence of heap leaks or validate real IME/screen readers.',
    candidates: {},
    checks,
  }
  for (const engine of ['codemirror', 'monaco']) {
    console.log(`Checking ${engine}`)
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    requests.clear()
    await page.goto(base)
    await expect(page.getByRole('status')).toHaveText('Textarea')
    const baseline = await sizes(requests)
    assert(
      !baseline.files.some((file) =>
        /codemirror-|monaco-|worker/.test(file.path),
      ),
      'engine must not load at boot',
    )
    requests.clear()
    const started = performance.now()
    await page
      .getByRole('button', {
        name: engine === 'monaco' ? 'Monaco' : 'CodeMirror',
        exact: true,
      })
      .click()
    await expect(page.getByRole('status')).toHaveText(`Ready: ${engine}`)
    const readyMs = performance.now() - started
    await expect(
      page.getByRole('textbox', { name: 'Code', exact: true }),
    ).toHaveCount(1)
    await diagnostics(page)
    const languageReadyMs = performance.now() - started
    await page.evaluate(() => window.spike.focus())
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('const greeting = "こんにちは 🌍";')
    await expect
      .poll(() => page.evaluate(() => window.spike.value()))
      .toContain('こんにちは 🌍')
    const typed = await page.evaluate(() => window.spike.value())
    assert.equal(await page.evaluate(() => window.spike.projection()), typed)
    const saves = await page.evaluate(() => window.spike.metrics().saves)
    await page.keyboard.press('Control+s')
    assert.equal(
      await page.evaluate(() => window.spike.metrics().saves),
      saves + 1,
    )
    await page.locator('#editing').dispatchEvent('compositionstart')
    await page.keyboard.press('Control+s')
    assert.equal(
      await page.evaluate(() => window.spike.metrics().saves),
      saves + 1,
    )
    await page.locator('#editing').dispatchEvent('compositionend')
    await page.evaluate(() => window.spike.undo())
    await expect
      .poll(() => page.evaluate(() => window.spike.value()))
      .not.toBe(typed)
    const changes = await page.evaluate(() => window.spike.metrics().changes)
    await page.evaluate(() =>
      window.spike.replace('const external: number = 1;\n'),
    )
    assert.equal(
      await page.evaluate(() => window.spike.projection()),
      'const external: number = 1;\n',
    )
    assert.equal(
      await page.evaluate(() => window.spike.metrics().changes),
      changes,
      'external replace must not echo as a local edit',
    )
    await page.evaluate(() => window.spike.undo())
    assert.equal(
      await page.evaluate(() => window.spike.value()),
      'const external: number = 1;\n',
      'external replacement clears old undo',
    )
    await page.evaluate(() => {
      window.spike.theme(true)
      window.spike.find()
    })
    await page.keyboard.press('Escape')
    const diagnosticCount = await diagnostics(page)
    const payload = await sizes(requests)
    if (engine === 'monaco') {
      assert.equal(diagnosticCount, 0, 'typed TypeScript document must parse')
      assert(
        payload.files.some((file) => /ts\.worker-/.test(file.path)),
        'real TS worker requested',
      )
    } else assert.equal(diagnosticCount, null)
    await page.evaluate(() => window.spike.focus())
    await page.keyboard.press('Tab')
    await expect(
      page.getByRole('button', { name: 'Save', exact: true }),
    ).toBeFocused()
    await page.setViewportSize({ width: 375, height: 667 })
    await page.evaluate(() => window.spike.focus())
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('// narrow')
    await expect
      .poll(() => page.evaluate(() => window.spike.value()))
      .toContain('// narrow')
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    if (engine === 'codemirror')
      assert.equal(
        narrowOverflow,
        false,
        'selected candidate must fit narrow viewport',
      )
    const largeText = 'const item = 1;\n'.repeat(Math.floor(1048576 / 16))
    const largeStarted = performance.now()
    await page.evaluate((text) => window.spike.replace(text), largeText)
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
    const largeReplaceMs = performance.now() - largeStarted
    assert.equal(await page.evaluate(() => window.spike.value()), largeText)
    assert.equal(
      await page.evaluate(() => window.spike.projection()),
      largeText,
    )
    const crlf = 'const crlf = 1;\r\n'
    await page.evaluate((text) => window.spike.replace(text), crlf)
    const crlfProjectionPreserved =
      (await page.evaluate(() => window.spike.projection())) === crlf
    assert.equal(
      await page.evaluate(() => window.spike.value()),
      crlf,
      'programmatic projection must not rewrite the canonical buffer',
    )
    await page.evaluate(() => window.spike.replace('const small = 1;\n'))
    await page.getByRole('button', { name: 'Dispose', exact: true }).click()
    const sharedBaseline = await page.evaluate(
      () => window.spike.metrics().sharedModels,
    )
    for (let index = 0; index < 10; index++) {
      await page
        .getByRole('button', {
          name: engine === 'monaco' ? 'Monaco' : 'CodeMirror',
          exact: true,
        })
        .click()
      await expect(page.getByRole('status')).toHaveText(`Ready: ${engine}`)
      await diagnostics(page)
      await page.getByRole('button', { name: 'Dispose', exact: true }).click()
      const metrics = await page.evaluate(() => window.spike.metrics())
      assert.equal(metrics.liveModels, 0)
      assert.equal(metrics.liveEditors, 0)
      assert.equal(
        metrics.sharedModels,
        sharedBaseline,
        'shared library model cache must stay bounded',
      )
      assert.equal(metrics.created, metrics.destroyed)
      assert(metrics.workers <= 2, 'worker count must remain bounded')
    }
    assert.deepEqual(errors, [])
    results.candidates[engine] = {
      baseline,
      payload,
      readyMs: Math.round(readyMs),
      largeReplaceMs: Math.round(largeReplaceMs),
      largeCodeUnits: largeText.length,
      diagnostics: diagnosticCount,
      languageReadyMs: Math.round(languageReadyMs),
      narrowOverflow,
      crlfProjectionPreserved,
      lifecycle: await page.evaluate(() => window.spike.metrics()),
    }
    checks.push(
      `${engine}: lazy/Unicode/save/synthetic-composition-guard/undo/find/theme/external-replace/Tab/narrow/1MiB/11-disposals/diagnostics`,
    )
    await context.close()
  }
  for (const engine of ['codemirror', 'monaco']) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.route(new RegExp(`/assets/${engine}-.*\\.js$`), (route) =>
      route.abort(),
    )
    await page.goto(base)
    await page
      .getByRole('textbox', { name: 'Code', exact: true })
      .fill('fallback draft')
    await page
      .getByRole('button', {
        name: engine === 'monaco' ? 'Monaco' : 'CodeMirror',
        exact: true,
      })
      .click()
    await expect(page.getByRole('status')).toContainText('Editor unavailable')
    await expect(
      page.getByRole('textbox', { name: 'Code', exact: true }),
    ).toHaveValue('fallback draft')
    checks.push(`${engine}: import failure retains editable textarea draft`)
    await context.close()
  }
  {
    const context = await browser.newContext()
    const page = await context.newPage()
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route(/\/assets\/codemirror-.*\.js$/, async (route) => {
      await gate
      await route.continue()
    })
    await page.goto(base)
    await page.getByRole('button', { name: 'CodeMirror', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Loading…')
    await page.getByRole('button', { name: 'Dispose', exact: true }).click()
    release()
    await page.waitForLoadState('networkidle')
    assert.equal(await page.evaluate(() => window.spike.metrics().created), 0)
    await expect(page.getByRole('status')).toHaveText('Textarea')
    checks.push(
      'late lazy completion after disposal cannot resurrect an editor',
    )
    await context.close()
  }
  const preservedCRLF = EditorState.create({
    doc: 'line one\r\nline two\r\n',
    extensions: [EditorState.lineSeparator.of('\r\n')],
  })
  assert.equal(preservedCRLF.sliceDoc(), 'line one\r\nline two\r\n')
  results.lineEndingMitigation = {
    uniformCRLF: 'lineSeparator + sliceDoc verified in Node',
    mixedLineEndings: 'requires an explicit integration policy; not verified',
  }
  checks.push(
    'CodeMirror uniform CRLF mitigation verified via lineSeparator + sliceDoc',
  )
  const allAssets = (await readdir(join(dist, 'assets'))).map(
    (name) => `assets/${name}`,
  )
  results.emitted = await sizes(allAssets)
  await writeFile(
    join(root, 'results.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  )
  console.log(
    JSON.stringify(
      {
        checks: checks.length,
        candidates: Object.fromEntries(
          Object.entries(results.candidates).map(([key, value]) => [
            key,
            {
              readyMs: value.readyMs,
              languageReadyMs: value.languageReadyMs,
              payloadRawBytes: value.payload.rawBytes,
              payloadGzipBytes: value.payload.gzipBytes,
              largeReplaceMs: value.largeReplaceMs,
              narrowOverflow: value.narrowOverflow,
              crlfProjectionPreserved: value.crlfProjectionPreserved,
              lifecycle: value.lifecycle,
            },
          ]),
        ),
      },
      null,
      2,
    ),
  )
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
