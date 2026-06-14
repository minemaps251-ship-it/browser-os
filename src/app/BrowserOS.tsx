import { AppBoundary } from './AppBoundary'
import { RuntimeProvider } from './RuntimeProvider'
import type { BrowserRuntime } from './createRuntime'
import { DesktopShell } from '../shell/desktop/DesktopShell'

export function BrowserOS({ runtime }: { runtime: BrowserRuntime }) {
  return (
    <AppBoundary
      onCrash={() => runtime.dispose()}
      fallback={
        <main className="desktop" role="alert">
          <h1>BrowserOS could not continue</h1>
          <p>Reload the workspace to try again.</p>
          <button onClick={() => window.location.reload()}>
            Reload BrowserOS
          </button>
        </main>
      }
    >
      <RuntimeProvider runtime={runtime}>
        <DesktopShell />
      </RuntimeProvider>
    </AppBoundary>
  )
}
