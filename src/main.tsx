import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/global.css'
import { BootScreen } from './app/BootScreen'
import { createBootController } from './app/boot'

const controller = createBootController()
const root = document.getElementById('root')
if (!root) throw new Error('BrowserOS root element is missing')
createRoot(root).render(
  <StrictMode>
    <BootScreen controller={controller} />
  </StrictMode>,
)
void controller.start()
if (import.meta.hot) import.meta.hot.dispose(() => controller.dispose())
