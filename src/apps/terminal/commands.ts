import { parsePath, type ParsedPath } from '../../core/filesystem/paths'
import type { VirtualFileSystem } from '../../core/filesystem/service'
import type { NodeId, VfsErrorCode } from '../../core/filesystem/types'
export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly directoryId?: NodeId
  readonly mutationStarted?: boolean
  readonly clearTranscript?: boolean
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
  | 'readFile'
  | 'copyFile'
  | 'move'
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
  if (code === 'CYCLE') return 'A folder cannot be moved inside itself.'
  if (code === 'PROTECTED') return 'This location or item is protected.'
  if (code === 'TOO_LARGE') return 'Workspace limit reached.'
  if (code === 'QUOTA') return 'Browser storage is full.'
  if (code === 'STORAGE_UNAVAILABLE')
    return 'Storage is unavailable. Try again.'
  if (code === 'CORRUPT_DATA')
    return 'Saved data could not be verified and has been preserved.'
  return 'The workspace could not be read. Try again.'
}
function parentPathOf(path: ParsedPath): string {
  const parent =
    (path.kind === 'absolute' ? '/' : '') +
    path.segments
      .slice(0, -1)
      .map((segment) =>
        segment.kind === 'name'
          ? segment.name
          : segment.kind === 'parent'
            ? '..'
            : '.',
      )
      .join('/')
  return parent || (path.kind === 'absolute' ? '/' : '.')
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
  if (
    ![
      'pwd',
      'ls',
      'cd',
      'help',
      'mkdir',
      'touch',
      'cat',
      'echo',
      'clear',
      'cp',
      'mv',
    ].includes(command)
  )
    return fail(
      `${command}: command not found. Use help to list commands.`,
      127,
    )
  if (command === 'echo')
    return { stdout: args.join(' '), stderr: '', exitCode: 0 }
  if (command === 'clear')
    return args.length
      ? fail('clear: too many arguments.', 2)
      : { stdout: '', stderr: '', exitCode: 0, clearTranscript: true }
  if (command === 'cat' && args.length !== 1)
    return fail('cat: expected one path.', 2)
  const transfer = command === 'cp' || command === 'mv'
  if (transfer && args.length !== 2)
    return fail(`${command}: expected a source and destination path.`, 2)
  const mutation = command === 'mkdir' || command === 'touch'
  if (mutation && args.length !== 1)
    return fail(`${command}: expected one path.`, 2)
  if (
    args.length >
    (transfer
      ? 2
      : command === 'ls' || command === 'cd' || command === 'cat' || mutation
        ? 1
        : 0)
  )
    return fail(`${command}: too many arguments.`, 2)
  if (command === 'help')
    return {
      stdout:
        'pwd — show the current path\nls [path] — list files and folders\ncd [path] — change folder (home by default)\nmkdir <path> — create a folder\ntouch <path> — create or update a file\ncat <path> — read a text file\necho [args…] — print literal text\nclear — clear this window output\ncp <source> <destination> — copy a file (no overwrite)\nmv <source> <destination> — move or rename a file or folder (no overwrite)\nhelp — show commands\nQuote paths containing spaces. Shell operators and expansion are not supported.',
      stderr: '',
      exitCode: 0,
    }
  let mutationStarted = false
  try {
    if (transfer) {
      const source = await vfs.resolve(args[0], cwd)
      if (signal.aborted) return fail('Command cancelled.', 130)
      if (!source.ok)
        return fail(`${command}: ${diagnostic(source.error.code)}`)
      const node = await vfs.stat(source.value)
      if (signal.aborted) return fail('Command cancelled.', 130)
      if (!node.ok) return fail(`${command}: ${diagnostic(node.error.code)}`)
      if (command === 'cp' && node.value.kind !== 'file')
        return fail(
          'cp: Only files can be copied; recursive copy is not supported.',
        )
      const parsed = parsePath(args[1])
      if (!parsed.ok)
        return fail(`${command}: ${diagnostic(parsed.error.code)}`)
      const destination = await vfs.resolve(args[1], cwd)
      if (signal.aborted) return fail('Command cancelled.', 130)
      let parentId: NodeId
      let newName: string | undefined
      if (destination.ok) {
        const target = await vfs.stat(destination.value)
        if (signal.aborted) return fail('Command cancelled.', 130)
        if (!target.ok)
          return fail(`${command}: ${diagnostic(target.error.code)}`)
        if (target.value.kind !== 'directory')
          return fail(
            `${command}: Destination already exists; overwrite is not supported.`,
          )
        parentId = target.value.id
      } else {
        if (
          destination.error.code !== 'NOT_FOUND' ||
          parsed.value.requiresDirectory
        )
          return fail(`${command}: ${diagnostic(destination.error.code)}`)
        const last = parsed.value.segments.at(-1)
        if (!last || last.kind !== 'name')
          return fail(`${command}: Invalid destination path.`, 2)
        const parent = await vfs.resolve(parentPathOf(parsed.value), cwd)
        if (signal.aborted) return fail('Command cancelled.', 130)
        if (!parent.ok)
          return fail(`${command}: ${diagnostic(parent.error.code)}`)
        parentId = parent.value
        newName = last.name
      }
      mutationStarted = true
      onMutationStart?.()
      const result =
        command === 'cp'
          ? await vfs.copyFile(source.value, parentId, newName)
          : await vfs.move(source.value, parentId, newName)
      return result.ok
        ? { stdout: '', stderr: '', exitCode: 0, mutationStarted: true }
        : {
            ...fail(`${command}: ${diagnostic(result.error.code)}`),
            mutationStarted: true,
          }
    }
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
      const parent = await vfs.resolve(parentPathOf(parsed.value), cwd)
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
    if (command === 'cat') {
      const document = await vfs.readFile(target.value)
      if (signal.aborted) return fail('Command cancelled.', 130)
      return document.ok
        ? { stdout: document.value.content.text, stderr: '', exitCode: 0 }
        : fail(`cat: ${diagnostic(document.error.code)}`)
    }
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
