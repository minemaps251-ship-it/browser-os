import type { EditorHandle } from './contracts'
import './style.css'
const required = <T extends HTMLElement>(selector: string) => {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`Missing ${selector}`)
  return node
}
const parent = required<HTMLDivElement>('#editor')
const fallback = required<HTMLTextAreaElement>('#fallback')
const status = required<HTMLParagraphElement>('#status')
const metrics = {
  created: 0,
  destroyed: 0,
  changes: 0,
  saves: 0,
  workers: 0,
  lastModels: 0,
}
const NativeWorker = window.Worker
class ObservedWorker extends NativeWorker {
  private terminated = false
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options)
    ++metrics.workers
  }
  terminate() {
    if (!this.terminated) {
      this.terminated = true
      --metrics.workers
    }
    super.terminate()
  }
}
window.Worker = ObservedWorker
let value = 'const answer = 42;\nconsole.log(answer);\n'
let handle: EditorHandle | null = null
let latestModels = () => 0
let latestSharedModels = () => 0
let dark = false,
  composing = false,
  generation = 0
fallback.value = value
fallback.addEventListener('input', () => {
  value = fallback.value
  ++metrics.changes
})
function destroy() {
  composing = false
  ++generation
  if (handle) {
    handle.dispose()
    ++metrics.destroyed
    handle = null
  }
  parent.replaceChildren()
  parent.hidden = true
  fallback.hidden = false
  fallback.value = value
  metrics.lastModels = latestModels()
  status.textContent = 'Textarea'
}
async function mount(engine: 'codemirror' | 'monaco') {
  destroy()
  const token = generation
  status.textContent = 'Loading…'
  try {
    const module =
      engine === 'codemirror'
        ? await import('./codemirror')
        : await import('./monaco')
    if (token !== generation) return
    parent.hidden = false
    fallback.hidden = true
    handle = module.mount(parent, {
      text: value,
      dark,
      onChange: (text) => {
        if (token === generation) {
          value = text
          ++metrics.changes
        }
      },
    })
    latestModels = handle.liveModels
    latestSharedModels = handle.sharedModels
    ++metrics.created
    status.textContent = `Ready: ${engine}`
  } catch {
    if (token === generation) {
      destroy()
      status.textContent = 'Editor unavailable — textarea kept'
    }
  }
}
required<HTMLButtonElement>('#codemirror').addEventListener(
  'click',
  () => void mount('codemirror'),
)
required<HTMLButtonElement>('#monaco').addEventListener(
  'click',
  () => void mount('monaco'),
)
required<HTMLButtonElement>('#destroy').addEventListener('click', destroy)
required<HTMLButtonElement>('#after').addEventListener('click', () => {
  ++metrics.saves
})
const save = (event: KeyboardEvent) => {
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === 's'
  ) {
    event.preventDefault()
    if (!composing && !event.isComposing && event.keyCode !== 229)
      ++metrics.saves
  }
}
required<HTMLDivElement>('#editing').addEventListener('keydown', save, true)
required<HTMLDivElement>('#editing').addEventListener(
  'compositionstart',
  () => {
    composing = true
  },
)
required<HTMLDivElement>('#editing').addEventListener('compositionend', () => {
  composing = false
})
window.spike = {
  value: () => value,
  projection: () => handle?.read() ?? fallback.value,
  metrics: () => ({
    ...metrics,
    liveModels: latestModels(),
    sharedModels: latestSharedModels(),
    liveEditors: parent.querySelectorAll('.cm-editor, .monaco-editor').length,
  }),
  replace: (text) => {
    value = text
    if (handle) handle.replace(text)
    else fallback.value = text
  },
  theme: (next) => {
    dark = next
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    handle?.theme(next)
  },
  focus: () => {
    if (handle) handle.focus()
    else fallback.focus()
  },
  undo: () => handle?.undo(),
  find: () => handle?.find(),
  diagnostics: () => handle?.diagnostics() ?? Promise.resolve(null),
  destroy,
}
declare global {
  interface Window {
    spike: {
      value(): string
      projection(): string
      metrics(): typeof metrics & {
        liveModels: number
        sharedModels: number
        liveEditors: number
      }
      replace(text: string): void
      theme(dark: boolean): void
      focus(): void
      undo(): void
      find(): void
      diagnostics(): Promise<number | null>
      destroy(): void
    }
  }
}
