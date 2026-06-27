import { openDatabase } from '../../../src/core/storage/database'
import { validateStoredVfs } from '../../../src/core/storage/readRepository'
import { persistentWorkspace, type Workspace } from '../../../src/app/workspace'
import { ROOT_NODE_ID } from '../../../src/core/filesystem/policy'
import type { NodeId } from '../../../src/core/filesystem/types'
import type { DatabaseConnection } from '../../../src/core/storage/types'
let workspace: Workspace | undefined
let connection: DatabaseConnection | undefined
function current() {
  if (!workspace) throw new Error('Missing workspace')
  return workspace
}
const refreshHarness = {
  async open(name: string) {
    workspace?.dispose()
    const opened = await openDatabase({ name })
    if (!opened.ok) throw new Error(opened.error.message)
    connection = opened.value
    const valid = await validateStoredVfs(connection)
    if (!valid.ok) {
      connection.close()
      throw new Error(valid.error.message)
    }
    workspace = persistentWorkspace(connection)
    const loaded = await workspace.settings.load()
    if (!loaded.ok) throw new Error(loaded.error.message)
  },
  async createFile() {
    return current().vfs.createFile(ROOT_NODE_ID, 'shared.txt', {
      kind: 'text',
      encoding: 'utf-8',
      text: 'From another tab',
    })
  },
  setDark: () => current().settings.setTheme('dark'),
  read: (id: string) => current().vfs.readFile(id as NodeId),
  remove: (id: string) =>
    current().vfs.remove(id as NodeId, { recursive: false }),
  async refresh() {
    await current().refresh.request()
    return {
      refresh: current().refresh.getSnapshot(),
      settings: current().settings.getSnapshot(),
      children: await current().vfs.listDirectory(ROOT_NODE_ID),
    }
  },
  closeConnection: () => connection?.close(),
  dispose: () => {
    workspace?.dispose()
    workspace = undefined
    connection = undefined
  },
  delete(name: string) {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Fixture cleanup blocked'))
    })
  },
}
window.refreshHarness = refreshHarness
declare global {
  interface Window {
    refreshHarness: typeof refreshHarness
  }
}
