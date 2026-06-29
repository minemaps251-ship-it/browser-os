import { useReducer, useRef, type KeyboardEvent } from 'react'
import { commandHistoryReducer, initialCommandHistory } from './history'

export function useCommandHistory() {
  const [state, dispatch] = useReducer(
    commandHistoryReducer,
    initialCommandHistory,
  )
  const composing = useRef(false)
  return {
    draft: state.draft,
    setDraft: (value: string) => dispatch({ type: 'edit', value }),
    submit: () => dispatch({ type: 'submit' }),
    isComposing: () => composing.current,
    onCompositionStart: () => {
      composing.current = true
    },
    onCompositionEnd: () => {
      composing.current = false
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>, enabled: boolean) => {
      const ime =
        composing.current ||
        event.nativeEvent.isComposing ||
        event.nativeEvent.keyCode === 229
      if (ime) {
        if (event.key === 'Enter') event.preventDefault()
        return
      }
      if (
        !enabled ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      dispatch({
        type: 'navigate',
        direction: event.key === 'ArrowUp' ? 'up' : 'down',
      })
    },
  }
}
