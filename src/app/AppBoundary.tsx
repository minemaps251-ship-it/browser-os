import { Component, type ReactNode } from 'react'

export class AppBoundary extends Component<
  { children: ReactNode; onCrash: () => void; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onCrash()
  }
  render() {
    if (this.state.failed && this.props.fallback) return this.props.fallback
    if (this.state.failed)
      return (
        <p role="alert">
          This application stopped unexpectedly. Close this window and open it
          again.
        </p>
      )
    return this.props.children
  }
}
