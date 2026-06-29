import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { expect, it } from 'vitest'
import { useCommandHistory } from './useCommandHistory'
function Input({ ready = true }: { ready?: boolean }) {
  const history = useCommandHistory()
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (ready && !history.isComposing()) history.submit()
      }}
    >
      <input
        aria-label="Command"
        value={history.draft}
        readOnly={!ready}
        onChange={(event) => history.setDraft(event.target.value)}
        onKeyDown={(event) => history.onKeyDown(event, ready)}
        onCompositionStart={history.onCompositionStart}
        onCompositionEnd={history.onCompositionEnd}
      />
    </form>
  )
}
it('ignores modified arrows, busy input and IME, then restores a draft under StrictMode', async () => {
  const user = userEvent.setup()
  const view = render(
    <StrictMode>
      <Input />
    </StrictMode>,
  )
  const input = screen.getByRole('textbox')
  await user.type(input, 'pwd{Enter}draft')
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'])
    fireEvent.keyDown(input, { key: 'ArrowUp', [modifier]: true })
  expect(input).toHaveValue('draft')
  fireEvent.compositionStart(input)
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  await user.keyboard('{Enter}')
  expect(input).toHaveValue('draft')
  fireEvent.compositionEnd(input)
  fireEvent.keyDown(input, { key: 'ArrowUp', isComposing: true })
  fireEvent.keyDown(input, { key: 'ArrowUp', keyCode: 229 })
  expect(input).toHaveValue('draft')
  view.rerender(
    <StrictMode>
      <Input ready={false} />
    </StrictMode>,
  )
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  expect(input).toHaveValue('draft')
  view.rerender(
    <StrictMode>
      <Input />
    </StrictMode>,
  )
  await user.keyboard('{ArrowUp}')
  expect(input).toHaveValue('pwd')
  await user.keyboard('{ArrowDown}')
  expect(input).toHaveValue('draft')
})
