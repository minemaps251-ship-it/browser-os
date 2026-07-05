export interface EditorHandle {
  read(): string
  replace(text: string): void
  focus(): void
  theme(dark: boolean): void
  undo(): void
  find(): void
  diagnostics(): Promise<number | null>
  dispose(): void
  liveModels(): number
  sharedModels(): number
}
export interface EditorOptions {
  text: string
  dark: boolean
  onChange(text: string): void
}
