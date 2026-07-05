import * as monaco from 'monaco-editor'
import { getTypeScriptWorker } from 'monaco-editor/languages/features/typescript/register'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'
import type { EditorHandle, EditorOptions } from './contracts'
let nextId = 0
export function mount(
  parent: HTMLElement,
  options: EditorOptions,
): EditorHandle {
  // Monaco pools workers in its engine services; disposing one model is not worker termination.
  window.MonacoEnvironment = {
    getWorker: (_id, label) =>
      label === 'javascript' || label === 'typescript'
        ? new TypeScriptWorker()
        : new EditorWorker(),
  }
  const model = monaco.editor.createModel(
    options.text,
    'typescript',
    monaco.Uri.parse(`browseros-spike:///document-${++nextId}.ts`),
  )
  let replacing = false,
    disposed = false
  const editor = monaco.editor.create(parent, {
    model,
    automaticLayout: true,
    minimap: { enabled: false },
    ariaLabel: 'Code',
    accessibilitySupport: 'on',
    tabFocusMode: true,
    theme: options.dark ? 'vs-dark' : 'vs',
  })
  const subscription = model.onDidChangeContent(() => {
    if (!replacing) options.onChange(model.getValue())
  })
  return {
    read: () => model.getValue(),
    replace: (text) => {
      replacing = true
      try {
        model.setValue(text)
      } finally {
        replacing = false
      }
    },
    focus: () => editor.focus(),
    theme: (dark) => monaco.editor.setTheme(dark ? 'vs-dark' : 'vs'),
    undo: () => {
      editor.trigger('spike', 'undo', null)
    },
    find: () => {
      editor.trigger('spike', 'actions.find', null)
    },
    diagnostics: async () => {
      const worker = await getTypeScriptWorker()
      const service = await worker(model.uri)
      return (await service.getSyntacticDiagnostics(model.uri.toString()))
        .length
    },
    dispose: () => {
      if (!disposed) {
        disposed = true
        subscription.dispose()
        editor.dispose()
        model.dispose()
      }
    },
    liveModels: () =>
      monaco.editor
        .getModels()
        .filter((model) => model.uri.scheme === 'browseros-spike').length,
    sharedModels: () =>
      monaco.editor
        .getModels()
        .filter((model) => model.uri.scheme !== 'browseros-spike').length,
  }
}
declare global {
  interface Window {
    MonacoEnvironment?: { getWorker(moduleId: string, label: string): Worker }
  }
}
