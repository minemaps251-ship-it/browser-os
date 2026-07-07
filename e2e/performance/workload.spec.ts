import { expect, test } from '@playwright/test'
import { writeFile, readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { cpus, platform, arch } from 'node:os'
import type {
  FileSystemNode,
  FileNode,
  ContentId,
  NodeId,
} from '../../src/core/filesystem/types.js'
import type { TotalsRecord } from '../../src/core/storage/types.js'

test('profiles bounded desktop workload and repeated resource release', async ({
  page,
  browser,
}, info) => {
  const measurements: Record<string, number[]> = {}
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const memory = async () => {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    await cdp.send('HeapProfiler.collectGarbage')
    return {
      heap: await cdp.send('Runtime.getHeapUsage'),
      dom: await cdp.send('Memory.getDOMCounters'),
    }
  }
  async function measure(name: string, action: () => Promise<unknown>) {
    const started = performance.now()
    await action()
    ;(measurements[name] ??= []).push(performance.now() - started)
  }
  await page.addInitScript(() => {
    const tasks: { duration: number; startTime: number }[] = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        tasks.push({ duration: entry.duration, startTime: entry.startTime })
    }).observe({ type: 'longtask', buffered: true })
    Object.defineProperty(window, '__workloadTasks', { get: () => tasks })
  })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'BrowserOS', exact: true }),
  ).toBeVisible()
  // Fixture-only atomic native seed; this isolated browser context has its own origin storage.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open('browser-os')
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const db = opening.result
          const tx = db.transaction(['nodes', 'contents', 'meta'], 'readwrite')
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          const nodes = tx.objectStore('nodes')
          const all = nodes.getAll()
          all.onsuccess = () => {
            const parent = (all.result as FileSystemNode[]).find(
              (node) => node.name === 'user',
            )
            if (!parent) {
              tx.abort()
              return
            }
            const large = 'const value = 123;\n'.repeat(14563) // ~256 KiB, below 1MiB file budget.
            let bytes = 0
            for (let index = 0; index < 1000; index++) {
              const text = index === 0 ? large : ''
              const size = new TextEncoder().encode(text).byteLength
              bytes += size
              const node: FileNode = {
                id: `perf-${index}` as NodeId,
                contentId: `perf-text-${index}` as ContentId,
                kind: 'file',
                parentId: parent.id,
                name:
                  index === 0
                    ? 'load.js'
                    : `item-${String(index).padStart(4, '0')}.txt`,
                createdAt: 1,
                updatedAt: 1,
                metadataRevision: 1,
                metadata: { protected: false },
                contentRevision: 1,
                mime: 'text/plain',
                byteLength: size,
              }
              nodes.add(node)
              tx.objectStore('contents').add({
                id: node.contentId,
                content: { kind: 'text', encoding: 'utf-8', text },
              })
            }
            tx.objectStore('meta').put({
              key: 'totals',
              nodeCount: all.result.length + 1000,
              textBytes: bytes,
            } satisfies TotalsRecord)
          }
        }
      }),
  )
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'BrowserOS', exact: true }),
  ).toBeVisible()
  const baseline = await memory()
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,v8,blink.user_timing',
    transferMode: 'ReturnAsStream',
  })
  const released = []
  const active = []
  for (let cycle = 0; cycle < 6; cycle++) {
    await measure('tenWindowsLaunch', async () => {
      for (let index = 0; index < 8; index++) {
        await page
          .getByRole('button', { name: 'Open Notes', exact: true })
          .click()
        await expect(
          page.getByRole('region', { name: 'Notes window' }),
        ).toHaveCount(index + 1)
      }
      await measure('filesList1000', async () => {
        await page
          .getByRole('button', { name: 'Open Files', exact: true })
          .click()
        await expect(
          page
            .getByRole('region', { name: 'Files window' })
            .getByRole('button', { name: /^Select file / }),
        ).toHaveCount(1000)
      })
      const files = page.getByRole('region', { name: 'Files window' })
      await expect(
        files.getByRole('button', { name: /^Select file / }),
      ).toHaveCount(1000)
      await files
        .getByRole('button', { name: 'Select file load.js', exact: true })
        .click()
      await files
        .getByRole('button', { name: 'Open in Code Editor', exact: true })
        .click()
      await expect(page.locator('.cm-content')).toBeVisible()
    })
    active.push(await memory())
    const editor = page.getByRole('region', { name: 'Code Editor window' })
    const code = editor.locator('.cm-content[contenteditable="true"]')
    await measure('editorEditSave', async () => {
      await code.press('ControlOrMeta+End')
      await code.pressSequentially(' // workload')
      await code.press('Control+s')
      await expect(
        editor.getByRole('status').filter({ hasText: /^Saved$/ }),
      ).toBeVisible()
    })
    await measure('editorTabRoundTrip', async () => {
      await editor.getByRole('button', { name: 'New tab', exact: true }).click()
      await editor.getByRole('tab', { name: /load.js/ }).click()
      await expect(code).toBeVisible()
    })
    await measure('pointerMove', async () => {
      const bounds = (await editor.boundingBox())!
      await page.mouse.move(bounds.x + 160, bounds.y + 20)
      await page.mouse.down()
      await page.mouse.move(bounds.x + 200, bounds.y + 50, { steps: 30 })
      await page.mouse.up()
    })
    await page
      .getByRole('region', { name: 'Notes window' })
      .last()
      .getByRole('button', { name: 'Close Notes', exact: true })
      .focus()
    await page.keyboard.press('Enter')
    await measure('terminalLargeCat', async () => {
      await page
        .getByRole('button', { name: 'Open Terminal', exact: true })
        .click()
      const terminal = page.getByRole('region', { name: 'Terminal window' })
      const command = terminal.getByRole('textbox', { name: 'Command' })
      await expect(command).not.toHaveAttribute('readonly', '')
      await command.fill('cat load.js')
      await command.press('Enter')
      await expect(terminal.getByRole('log')).toContainText('Output truncated')
    })
    await measure('closeAll', async () => {
      for (const name of ['Terminal', 'Code Editor', 'Files', 'Notes']) {
        const regions = page.getByRole('region', {
          name: `${name} window`,
          exact: true,
        })
        while (await regions.count()) {
          const before = await regions.count()
          const close = regions
            .last()
            .getByRole('button', { name: `Close ${name}`, exact: true })
          await close.focus()
          await close.press('Enter')
          await expect(regions).toHaveCount(before - 1)
        }
      }
    })
    await expect(page.locator('.cm-editor')).toHaveCount(0)
    released.push(await memory())
  }
  const complete = new Promise<{ stream?: string }>((resolve) =>
    cdp.once('Tracing.tracingComplete', resolve),
  )
  await cdp.send('Tracing.end')
  const { stream } = await complete
  if (!stream) throw new Error('Trace stream missing')
  let trace = ''
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream })
    trace += chunk.data
    if (chunk.eof) break
  }
  await cdp.send('IO.close', { handle: stream })
  const tracePath = info.outputPath('browser-trace.json')
  await writeFile(tracePath, trace)
  await info.attach('browser-trace', {
    path: tracePath,
    contentType: 'application/json',
  })
  const bundles = []
  for (const name of await readdir('dist/assets')) {
    if (!/\.(js|css)$/.test(name)) continue
    const data = await readFile(`dist/assets/${name}`)
    bundles.push({
      name,
      bytes: data.byteLength,
      gzipBytes: gzipSync(data).byteLength,
    })
  }
  const report = {
    environment: {
      browser: browser.version(),
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
    },
    workload: {
      files: 1000,
      windows: 10,
      cycles: 6,
      editorApproxKiB: 256,
      throttling: 'none',
      timingsIncludeAutomation: true,
    },
    measurements,
    baseline,
    active,
    released,
    longTasks: await page.evaluate(
      () => Reflect.get(window, '__workloadTasks') as unknown,
    ),
    resources: await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => ({ name: entry.name, duration: entry.duration })),
    ),
    browserMetrics: await cdp.send('Performance.getMetrics'),
    bundles,
  }
  const path = info.outputPath('report.json')
  await writeFile(path, JSON.stringify(report, null, 2))
  await info.attach('performance-report', {
    path,
    contentType: 'application/json',
  })
  expect(errors).toEqual([])
})
