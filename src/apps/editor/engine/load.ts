import type { EngineModule } from './types'
export function loadEditorEngine(): Promise<EngineModule> {
  return import('./codeMirror')
}
