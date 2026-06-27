import {
  createRefreshService,
  type RefreshService,
} from '../core/refresh/service'
import { validateStoredMetadata } from '../core/storage/readRepository'
import {
  createSettingsService,
  type SettingsService,
} from '../core/settings/service'
import { createMemorySettingsRepository } from '../core/settings/memoryRepository'
import { createIndexedDbSettingsRepository } from '../core/storage/settingsRepository'
import { createVfsService } from '../core/filesystem/service'
import { createMemoryVfsRepository } from '../core/filesystem/memoryRepository'
import { createIndexedDbVfsRepository } from '../core/storage/createRepository'
import type { ContentId, NodeId } from '../core/filesystem/types'
import type { DatabaseConnection } from '../core/storage/types'

const options = {
  now: Date.now,
  createNodeId: () => crypto.randomUUID() as NodeId,
  createContentId: () => crypto.randomUUID() as ContentId,
  createOperationId: () => crypto.randomUUID(),
}
export interface Workspace {
  readonly vfs: ReturnType<typeof createVfsService>
  readonly settings: SettingsService
  readonly refresh: RefreshService
  readonly mode: 'persistent' | 'temporary'
  dispose(): void
}
export function persistentWorkspace(connection: DatabaseConnection): Workspace {
  const settings = createSettingsService(
    createIndexedDbSettingsRepository(connection),
  )
  const refresh = createRefreshService({
    settings,
    validate: () => validateStoredMetadata(connection),
  })
  return {
    refresh,
    vfs: createVfsService(createIndexedDbVfsRepository(connection, options)),
    settings,
    mode: 'persistent',
    dispose: () => {
      refresh.dispose()
      settings.dispose()
      connection.close()
    },
  }
}
export function temporaryWorkspace(): Workspace {
  const repository = createMemoryVfsRepository(options)
  if (!repository.ok) throw new Error(repository.error.message)
  const settings = createSettingsService(createMemorySettingsRepository())
  const refresh = createRefreshService({
    settings,
    validate: async () => ({ ok: true }),
  })
  return {
    refresh,
    settings,
    vfs: createVfsService(repository.value),
    mode: 'temporary',
    dispose: () => {
      refresh.dispose()
      settings.dispose()
    },
  }
}
