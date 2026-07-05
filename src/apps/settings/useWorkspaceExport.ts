import { useEffect, useRef, useState } from 'react'
import type { ExportArtifact, ExportResult } from '../../core/export/types'
type ExportState =
  | { readonly phase: 'idle' | 'busy' }
  | { readonly phase: 'error'; readonly message: string }
  | {
      readonly phase: 'ready'
      readonly url: string
      readonly artifact: Omit<ExportArtifact, 'json'>
    }
export function useWorkspaceExport(
  prepare: () => Promise<ExportResult<ExportArtifact>>,
) {
  const [state, setState] = useState<ExportState>({ phase: 'idle' })
  const alive = useRef(false),
    pending = useRef(false),
    generation = useRef(0)
  const url = useRef<string | null>(null)
  useEffect(() => {
    alive.current = true
    generation.current++
    return () => {
      alive.current = false
      pending.current = false
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = null
    }
  }, [prepare])
  async function prepareCopy() {
    if (!alive.current || pending.current) return
    pending.current = true
    const request = ++generation.current
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
    setState({ phase: 'busy' })
    try {
      const result = await prepare()
      if (!alive.current || generation.current !== request) return
      if (!result.ok) {
        setState({ phase: 'error', message: result.error.message })
        return
      }
      const { json, ...artifact } = result.value
      const objectUrl = URL.createObjectURL(
        new Blob([json], {
          type: 'application/json;charset=utf-8',
        }),
      )
      url.current = objectUrl
      setState({ phase: 'ready', url: objectUrl, artifact })
    } catch {
      if (alive.current && generation.current === request)
        setState({
          phase: 'error',
          message:
            'Your browser could not prepare this download. Please retry.',
        })
    } finally {
      if (generation.current === request) pending.current = false
    }
  }
  return { state, prepareCopy }
}
