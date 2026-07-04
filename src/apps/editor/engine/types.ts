import type { LineEnding } from './lineEndings'
export interface EditorProjection {
  readonly text: string
  readonly name: string
  readonly dark: boolean
  readonly separator: LineEnding
}
export interface EditorSelection {
  readonly anchor: number
  readonly head: number
}
export interface EngineHandle {
  sync(projection: EditorProjection): void
  focus(): void
  selection(): EditorSelection
  dispose(): void
}
export interface EnginePool {
  retain(ids: readonly string[]): void
  mount(
    host: HTMLElement,
    id: string,
    projection: EditorProjection,
    callbacks: { edit(text: string): void; fail(): void },
    selection?: EditorSelection,
  ): EngineHandle
  dispose(): void
}
export interface EngineModule {
  createEnginePool(): EnginePool
}
