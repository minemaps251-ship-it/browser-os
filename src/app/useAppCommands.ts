import { createContext, useContext, useEffect } from 'react'
import type { ProcessId } from '../core/shared/ids'
import type { AppCommand } from '../core/commands/service'
import { useRuntime } from './runtimeContext'

export const CommandOwnerContext = createContext<ProcessId | null>(null)
/** A contribution is replaced after every committed app render: no stale enabled state or closures. */
export function useAppCommands(commands: readonly AppCommand[]) {
  const runtime = useRuntime()
  const owner = useContext(CommandOwnerContext)
  useEffect(() => {
    if (owner) return runtime.commands.register(owner, commands)
  })
}
