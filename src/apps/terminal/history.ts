export interface CommandHistoryState {
  readonly entries: readonly string[]
  readonly draft: string
  readonly cursor: number | null
  readonly savedDraft: string
}
export const initialCommandHistory: CommandHistoryState = {
  entries: [],
  draft: '',
  cursor: null,
  savedDraft: '',
}
export type CommandHistoryAction =
  | { readonly type: 'edit'; readonly value: string }
  | { readonly type: 'submit' }
  | { readonly type: 'navigate'; readonly direction: 'up' | 'down' }
export function commandHistoryReducer(
  state: CommandHistoryState,
  action: CommandHistoryAction,
): CommandHistoryState {
  if (action.type === 'edit')
    return {
      ...state,
      draft: action.value.slice(0, 4096),
      cursor: null,
      savedDraft: '',
    }
  if (action.type === 'submit') {
    if (!state.draft.trim()) return state
    const entries =
      state.entries.at(-1) === state.draft
        ? [...state.entries]
        : [...state.entries, state.draft]
    let size = entries.reduce((total, entry) => total + entry.length, 0)
    while (entries.length > 50 || size > 32000) size -= entries.shift()!.length
    return { entries, draft: '', cursor: null, savedDraft: '' }
  }
  if (!state.entries.length) return state
  if (action.direction === 'up') {
    const cursor =
      state.cursor === null
        ? state.entries.length - 1
        : Math.max(0, state.cursor - 1)
    return {
      ...state,
      cursor,
      draft: state.entries[cursor],
      savedDraft: state.cursor === null ? state.draft : state.savedDraft,
    }
  }
  if (state.cursor === null) return state
  if (state.cursor === state.entries.length - 1)
    return { ...state, cursor: null, draft: state.savedDraft, savedDraft: '' }
  const cursor = state.cursor + 1
  return { ...state, cursor, draft: state.entries[cursor] }
}
