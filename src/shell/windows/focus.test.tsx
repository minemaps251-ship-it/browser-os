import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import {
  focusWindowElement,
  rememberWindowFocus,
  windowElementId,
} from './focus'
import type { WindowId } from '../../core/shared/ids'

it('remembers content focus, ignores chrome, and falls back for unavailable targets', () => {
  const id = 'focus-test' as WindowId
  render(
    <>
      <button>Outside</button>
      <section id={windowElementId(id)} tabIndex={-1} aria-label="Test window">
        <button>Chrome</button>
        <div data-window-content>
          <input aria-label="Draft" />
        </div>
      </section>
    </>,
  )
  const frame = screen.getByRole('region', { name: 'Test window' })
  const input = screen.getByRole('textbox', {
    name: 'Draft',
  }) as HTMLInputElement
  const outside = screen.getByRole('button', { name: 'Outside' })
  rememberWindowFocus(frame, input)
  rememberWindowFocus(frame, screen.getByRole('button', { name: 'Chrome' }))
  outside.focus()
  focusWindowElement(id)
  expect(input).toHaveFocus()
  input.disabled = true
  outside.focus()
  focusWindowElement(id)
  expect(frame).toHaveFocus()
  input.remove()
  outside.focus()
  focusWindowElement(id)
  expect(frame).toHaveFocus()
  frame.hidden = true
  outside.focus()
  focusWindowElement(id)
  expect(outside).toHaveFocus()
})
