import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EngineOwner } from './engine/owner'
import type {
  EngineHandle,
  EditorProjection,
  EditorSelection,
} from './engine/types'
import type { EditorTab } from './workspace'
import { lineEnding } from './engine/lineEndings'

function projection(tab: EditorTab, dark: boolean): EditorProjection | null {
  const snapshot = tab.session.getSnapshot()
  if (snapshot.status !== 'ready') return null
  const baseline = lineEnding(snapshot.baseline)
  const separator = lineEnding(
    snapshot.buffer,
    baseline === 'mixed' ? '\n' : baseline,
  )
  if (separator === 'mixed') return null
  return { text: snapshot.buffer, name: snapshot.name, dark, separator }
}
export function useCodeMirror(
  owner: EngineOwner,
  tab: EditorTab,
  dark: boolean,
) {
  const host = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const handle = useRef<EngineHandle | null>(null)
  const composing = useRef(false)
  const attach = useRef<(() => void) | null>(null)
  const latest = useRef({ tab, dark })
  const focusPending = useRef(false)
  const savedSelection = useRef<EditorSelection | undefined>(undefined)
  const failCurrent = useRef<(() => void) | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  // Sessions publish text and metadata independently of tab identity.
  useLayoutEffect(() => {
    latest.current = { tab, dark }
    const next = projection(tab, dark)
    if (handle.current && next) {
      try {
        handle.current.sync(next)
      } catch {
        queueMicrotask(() => failCurrent.current?.())
      }
    }
  })
  useEffect(() => {
    let active = true
    let failed = false
    const fail = () => {
      if (!active || failed) return
      failed = true
      savedSelection.current = handle.current?.selection()
      focusPending.current = !!host.current?.contains(document.activeElement)
      handle.current?.dispose()
      handle.current = null
      host.current?.replaceChildren()
      setPhase('failed')
    }
    failCurrent.current = fail
    void owner.get().then((pool) => {
      if (!active) return
      const mount = () => {
        if (!active || failed || composing.current || handle.current) return
        const current = latest.current
        const next = projection(current.tab, current.dark)
        const parent = host.current
        if (!next || !parent) return
        const input = textarea.current
        const focused = document.activeElement === input
        const seed =
          focused && input
            ? {
                anchor:
                  input.selectionDirection === 'backward'
                    ? input.selectionEnd
                    : input.selectionStart,
                head:
                  input.selectionDirection === 'backward'
                    ? input.selectionStart
                    : input.selectionEnd,
              }
            : undefined
        try {
          const view = pool.mount(
            parent,
            tab.id,
            next,
            {
              edit: (text) => {
                if (active && !failed) latest.current.tab.session.edit(text)
              },
              fail,
            },
            seed,
          )
          if (failed) {
            view.dispose()
            return
          }
          handle.current = view
          focusPending.current = focused
          setPhase('ready')
        } catch {
          fail()
        }
      }
      attach.current = mount
      mount()
    }, fail)
    return () => {
      active = false
      failCurrent.current = null
      attach.current = null
      handle.current?.dispose()
      handle.current = null
    }
  }, [owner, tab.id])
  useLayoutEffect(() => {
    if (phase === 'ready' && focusPending.current) handle.current?.focus()
    if (phase === 'failed' && textarea.current) {
      const selection = savedSelection.current
      if (selection)
        textarea.current.setSelectionRange(
          Math.min(selection.anchor, selection.head),
          Math.max(selection.anchor, selection.head),
        )
      if (focusPending.current) textarea.current.focus()
    }
    focusPending.current = false
  }, [phase])
  const compositionStart = () => {
    composing.current = true
  }
  const compositionEnd = () => {
    composing.current = false
    queueMicrotask(() => attach.current?.())
  }
  return { host, textarea, phase, compositionStart, compositionEnd }
}
