import type { VirtualFileSystem } from '../../core/filesystem/service'
import type { NodeId, VfsErrorCode } from '../../core/filesystem/types'
export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly directoryId?: NodeId
}
export type TerminalVfs = Pick<
  VirtualFileSystem,
  'resolve' | 'stat' | 'listDirectory' | 'pathOf' | 'subscribe'
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
  if (code === 'CORRUPT_DATA')
    return 'Saved data could not be verified and has been preserved.'
  return 'The workspace could not be read. Try again.'
}
export async function executeCommand(
  tokens: readonly string[],
  cwd: NodeId,
  vfs: TerminalVfs,
  signal: AbortSignal,
): Promise<CommandResult> {
  const [command, ...args] = tokens
  if (signal.aborted) return fail('Command cancelled.', 130)
  if (!command) return { stdout: '', stderr: '', exitCode: 0 }
  if (!['pwd', 'ls', 'cd', 'help'].includes(command))
    return fail(
      `${command}: command not found. Use help to list commands.`,
      127,
    )
  if (args.length > (command === 'ls' || command === 'cd' ? 1 : 0))
    return fail(`${command}: too many arguments.`, 2)
  if (command === 'help')
    return {
      stdout:
        'pwd — show the current path\nls [path] — list files and folders\ncd [path] — change folder (home by default)\nhelp — show commands\nQuote paths containing spaces. Shell operators and expansion are not supported.',
      stderr: '',
      exitCode: 0,
    }
  try {
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
    return signal.aborted
      ? fail('Command cancelled.', 130)
      : fail(`${command}: The workspace could not be read. Try again.`)
  }
}
