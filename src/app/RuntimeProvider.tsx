import type { ReactNode } from 'react'
import type { BrowserRuntime } from './createRuntime'
import { RuntimeContext } from './runtimeContext'

export function RuntimeProvider({
  runtime,
  children,
}: {
  runtime: BrowserRuntime
  children: ReactNode
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  )
}
