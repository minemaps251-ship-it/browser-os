import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import type { NodeId } from '../../core/filesystem/types'
import type { RefreshService } from '../../core/refresh/service'
import { parseCommand } from './parser'
import {
  executeCommand,
  type TerminalVfs,
  type CommandResult,
} from './commands'
export interface TranscriptEntry extends CommandResult {
  readonly id: number
  readonly command: string
}
export interface TerminalSnapshot {
  readonly status: 'loading' | 'ready' | 'busy' | 'error'
  readonly directoryId: NodeId | null
  readonly path: string
  readonly entries: readonly TranscriptEntry[]
  readonly notice: string | null
  readonly trimmed: boolean
}
export function createTerminalSession(
  vfs: TerminalVfs,
  refresh: Pick<RefreshService, 'subscribe' | 'getSnapshot'>,
) {
  let snapshot: TerminalSnapshot = Object.freeze({
    status: 'loading',
    directoryId: null,
    path: '',
    entries: Object.freeze([]),
    notice: null,
    trimmed: false,
  })
  const listeners = new Set<() => void>()
  let running = false
  let generation = 0
  let entryId = 0
  let controller: AbortController | null = null
  let offVfs: (() => void) | undefined
  let offRefresh: (() => void) | undefined
  function publish(patch: Partial<TerminalSnapshot>) {
    snapshot = Object.freeze({ ...snapshot, ...patch })
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* Observers do not cancel a command. */
      }
    }
  }
  function append(command: string, result: CommandResult) {
    const cap = (text: string) =>
      text.length > 12000 ? `${text.slice(0, 12000)}\n[Output truncated]` : text
    const entries = [
      ...snapshot.entries,
      Object.freeze({
        ...result,
        stdout: cap(result.stdout),
        stderr: cap(result.stderr),
        id: ++entryId,
        command: command.slice(0, 4096),
      }),
    ]
    let size = entries.reduce(
      (total, entry) =>
        total +
        entry.command.length +
        entry.stdout.length +
        entry.stderr.length,
      0,
    )
    let trimmed = snapshot.trimmed
    while (entries.length > 40 || size > 32000) {
      const removed = entries.shift()!
      size -=
        removed.command.length + removed.stdout.length + removed.stderr.length
      trimmed = true
    }
    publish({ entries: Object.freeze(entries), trimmed })
  }
  async function location(id: NodeId | null, token: number): Promise<boolean> {
    try {
      let target = id
      let notice: string | null = null
      if (target) {
        const path = await vfs.pathOf(target)
        if (!running || token !== generation) return false
        if (path.ok) {
          publish({ directoryId: target, path: path.value })
          return true
        }
        if (path.error.code !== 'NOT_FOUND') throw new Error('Read failed')
        notice = 'The current folder was removed. Returned to your home folder.'
      }
      const home = await vfs.resolve('/home/user', ROOT_NODE_ID)
      if (!running || token !== generation) return false
      if (!home.ok && home.error.code !== 'NOT_FOUND')
        throw new Error('Read failed')
      target = home.ok ? home.value : ROOT_NODE_ID
      const path = await vfs.pathOf(target)
      if (!running || token !== generation) return false
      if (!path.ok) throw new Error('Read failed')
      publish({
        directoryId: target,
        path: path.value,
        notice: home.ok
          ? notice
          : 'Home is unavailable. Using the workspace root.',
      })
      return true
    } catch {
      if (running && token === generation)
        publish({
          status: 'error',
          notice: 'The current folder could not be read. Retry to continue.',
        })
      return false
    }
  }
  async function refreshPath() {
    if (!running || controller) return
    const token = ++generation
    publish({ status: 'loading', notice: null })
    if (await location(snapshot.directoryId, token))
      publish({ status: 'ready' })
  }
  async function run(command: string) {
    if (
      !running ||
      snapshot.status !== 'ready' ||
      controller ||
      !command.trim()
    )
      return false
    const token = ++generation
    const active = new AbortController()
    controller = active
    publish({ status: 'busy', notice: null })
    const valid = () => running && generation === token
    try {
      if (!(await location(snapshot.directoryId, token)) || !valid())
        return false
      const parsed = parseCommand(command)
      const result: CommandResult = parsed.ok
        ? await executeCommand(
            parsed.tokens,
            snapshot.directoryId!,
            vfs,
            active.signal,
          )
        : {
            stdout: '',
            stderr: `${parsed.message} (column ${parsed.position + 1})`,
            exitCode: 2,
          }
      if (!valid()) return false
      if (active.signal.aborted)
        append(command, {
          stdout: '',
          stderr: 'Command cancelled.',
          exitCode: 130,
        })
      else {
        append(command, result)
        if (result.directoryId) publish({ directoryId: result.directoryId })
      }
      const located = await location(snapshot.directoryId, token)
      if (valid() && located) publish({ status: 'ready' })
      return true
    } finally {
      if (controller === active) controller = null
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    run,
    cancel: () => {
      controller?.abort()
    },
    retry: refreshPath,
    start: () => {
      if (running) return
      running = true
      offVfs = vfs.subscribe({ kind: 'all' }, (event) => {
        const cwd = snapshot.directoryId
        if (
          !cwd ||
          event.pathIds.includes(cwd) ||
          event.removedIds.includes(cwd)
        )
          void refreshPath()
      })
      let revision = refresh.getSnapshot().revision
      offRefresh = refresh.subscribe(() => {
        const next = refresh.getSnapshot().revision
        if (next !== revision) {
          revision = next
          void refreshPath()
        }
      })
      void refreshPath()
    },
    stop: () => {
      running = false
      ++generation
      controller?.abort()
      controller = null
      offVfs?.()
      offRefresh?.()
    },
  }
}
