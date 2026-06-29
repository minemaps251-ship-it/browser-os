import { parsePath } from '../../core/filesystem/paths'
import type { VirtualFileSystem } from '../../core/filesystem/service'
import type { NodeId, VfsErrorCode } from '../../core/filesystem/types'
export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly directoryId?: NodeId
  readonly mutationStarted?: boolean
}
export type TerminalVfs = Pick<
  VirtualFileSystem,
  | 'resolve'
  | 'stat'
  | 'listDirectory'
  | 'pathOf'
  | 'subscribe'
  | 'createDirectory'
  | 'touchFile'
>
const fail = (stderr: string, exitCode = 1): CommandResult => ({
  stdout: '',
  stderr,
  exitCode,
})
function diagnostic(code: VfsErrorCode) {
  if (code === 'NOT_FOUND') return 'No such file or folder.'
  if (code === 'NOT_DIRECTORY') return 'Not a folder.'
  if (code === 'INVALID_PATH' || code === 'INVALID_NAME') return 'Invalid path.'
  if (code === 'ALREADY_EXISTS') return 'An item with this name already exists.'
  if (code === 'NOT_FILE') return 'Existing item is not a file.'
  if (code === 'PROTECTED') return 'This location or item is protected.'
  if (code === 'TOO_LARGE') return 'Workspace limit reached.'
  if (code === 'QUOTA') return 'Browser storage is full.'
  if (code === 'STORAGE_UNAVAILABLE')
    return 'Storage is unavailable. Try again.'
  if (code === 'CORRUPT_DATA')
    return 'Saved data could not be verified and has been preserved.'
  return 'The workspace could not be read. Try again.'
}
export async function executeCommand(
  tokens: readonly string[],
  cwd: NodeId,
  vfs: TerminalVfs,
  signal: AbortSignal,
  onMutationStart?: () => void,
): Promise<CommandResult> {
  const [command, ...args] = tokens
  if (signal.aborted) return fail('Command cancelled.', 130)
  if (!command) return { stdout: '', stderr: '', exitCode: 0 }
  if (!['pwd', 'ls', 'cd', 'help', 'mkdir', 'touch'].includes(command))
    return fail(
      `${command}: command not found. Use help to list commands.`,
      127,
    )
  const mutation = command === 'mkdir' || command === 'touch'
  if (mutation && args.length !== 1)
    return fail(`${command}: expected one path.`, 2)
  if (args.length > (command === 'ls' || command === 'cd' || mutation ? 1 : 0))
    return fail(`${command}: too many arguments.`, 2)
  if (command === 'help')
    return {
      stdout:
        'pwd — show the current path\nls [path] — list files and folders\ncd [path] — change folder (home by default)\nmkdir <path> — create a folder\ntouch <path> — create or update a file\nhelp — show commands\nQuote paths containing spaces. Shell operators and expansion are not supported.',
      stderr: '',
      exitCode: 0,
    }
  let mutationStarted = false
  try {
    if (mutation) {
      const parsed = parsePath(args[0])
      if (!parsed.ok)
        return fail(`${command}: ${diagnostic(parsed.error.code)}`)
      const last = parsed.value.segments.at(-1)
      if (
        !last ||
        last.kind !== 'name' ||
        (command === 'touch' && parsed.value.requiresDirectory)
      )
        return fail(
          `${command}: expected a file or folder name, not a directory-only path.`,
          2,
        )
      const parentSegments = parsed.value.segments.slice(0, -1)
      const parentPath =
        (parsed.value.kind === 'absolute' ? '/' : '') +
        parentSegments
          .map((segment) =>
            segment.kind === 'name'
              ? segment.name
              : segment.kind === 'parent'
                ? '..'
                : '.',
          )
          .join('/')
      const parent = await vfs.resolve(
        parentPath || (parsed.value.kind === 'absolute' ? '/' : '.'),
        cwd,
      )
      if (signal.aborted) return fail('Command cancelled.', 130)
      if (!parent.ok)
        return fail(`${command}: ${diagnostic(parent.error.code)}`)
      mutationStarted = true
      onMutationStart?.()
      const result =
        command === 'mkdir'
          ? await vfs.createDirectory(parent.value, last.name)
          : await vfs.touchFile(parent.value, last.name)
      return result.ok
        ? { stdout: '', stderr: '', exitCode: 0, mutationStarted: true }
        : {
            ...fail(`${command}: ${diagnostic(result.error.code)}`),
            mutationStarted: true,
          }
    }
    if (command === 'pwd') {
      const path = await vfs.pathOf(cwd)
      if (signal.aborted) return fail('Command cancelled.', 130)
      return path.ok
        ? { stdout: path.value, stderr: '', exitCode: 0 }
        : fail(`pwd: ${diagnostic(path.error.code)}`)
    }
    const target = await vfs.resolve(
      command === 'cd' ? (args[0] ?? '/home/user') : (args[0] ?? '.'),
      cwd,
    )
    if (signal.aborted) return fail('Command cancelled.', 130)
    if (!target.ok) return fail(`${command}: ${diagnostic(target.error.code)}`)
    if (command === 'cd') {
      const node = await vfs.stat(target.value)
      if (signal.aborted) return fail('Command cancelled.', 130)
      if (!node.ok) return fail(`cd: ${diagnostic(node.error.code)}`)
      if (node.value.kind !== 'directory') return fail('cd: Not a folder.')
      return { stdout: '', stderr: '', exitCode: 0, directoryId: node.value.id }
    }
    const entries = await vfs.listDirectory(target.value)
    if (signal.aborted) return fail('Command cancelled.', 130)
    if (!entries.ok) return fail(`ls: ${diagnostic(entries.error.code)}`)
    const sorted = [...entries.value].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    return {
      stdout: sorted
        .map((entry) => `${entry.name}${entry.kind === 'directory' ? '/' : ''}`)
        .join('\n'),
      stderr: '',
      exitCode: 0,
    }
  } catch {
    return signal.aborted && !mutationStarted
      ? fail('Command cancelled.', 130)
      : {
          ...fail(
            `${command}: The workspace operation could not complete. Try again.`,
          ),
          mutationStarted,
        }
  }
}
