import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BrowserOS } from './app/BrowserOS'
import { createBrowserRuntime } from './app/createRuntime'

const runtime = createBrowserRuntime()
const root = document.getElementById('root')
if (!root) throw new Error('BrowserOS root element is missing')
createRoot(root).render(
  <StrictMode>
    <BrowserOS runtime={runtime} />
  </StrictMode>,
)
if (import.meta.hot) import.meta.hot.dispose(() => runtime.dispose())
