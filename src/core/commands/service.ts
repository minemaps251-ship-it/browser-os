import type { ProcessId } from '../shared/ids'

export type CommandGroup = 'File' | 'Edit' | 'View'
export interface AppCommand {
  readonly id: string
  readonly label: string
  readonly group: CommandGroup
  readonly enabled: boolean
  readonly shortcut?: 'save' | 'save-as' | 'new'
  readonly run: () => void
}
/** Commands belong to a mounted process contribution, never to a DOM selector. */
export function createCommandService() {
  const owners = new Map<
    ProcessId,
    { token: object; commands: readonly AppCommand[] }
  >()
  const listeners = new Set<() => void>()
  const empty: readonly AppCommand[] = Object.freeze([])
  let disposed = false
  const publish = () => {
    for (const listener of listeners) listener()
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    list: (owner: ProcessId | null) =>
      owner ? (owners.get(owner)?.commands ?? empty) : empty,
    register: (owner: ProcessId, commands: readonly AppCommand[]) => {
      if (disposed) return () => {}
      if (
        new Set(commands.map((command) => command.id)).size !== commands.length
      )
        throw new Error('Duplicate command ID')
      const token = {}
      owners.set(owner, { token, commands: Object.freeze([...commands]) })
      publish()
      return () => {
        if (owners.get(owner)?.token === token) {
          owners.delete(owner)
          publish()
        }
      }
    },
    execute: (owner: ProcessId, id: string) => {
      if (disposed) return false
      const command = owners
        .get(owner)
        ?.commands.find((command) => command.id === id)
      if (!command?.enabled) return false
      command.run()
      return true
    },
    remove: (owner: ProcessId) => {
      if (owners.delete(owner)) publish()
    },
    dispose: () => {
      disposed = true
      owners.clear()
      listeners.clear()
    },
  }
}
