import { createContext, useContext } from 'react'
import type { BrowserRuntime } from './createRuntime'

export const RuntimeContext = createContext<BrowserRuntime | null>(null)
export function useRuntime() {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('BrowserOS runtime is missing')
  return runtime
}
