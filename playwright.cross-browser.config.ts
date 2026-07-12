import { defineConfig, devices } from '@playwright/test'
import desktop from './playwright.config.js'

// Reuse the same critical contracts rather than maintaining weaker browser copies.
const scenarios = [
  'shared shortcuts target the active process and ignore composition and modal dialogs',
  'active app menus save through the document session and preserve close guards',
  'menus support keyboard navigation, dismissal and current app contributions',
  'Dock supports pinning, keyboard reorder, drag reorder and reload persistence',
  'desktop context and settings persist wallpaper, sorting and motion preferences',
  'failed desktop preference writes retain the committed layout and allow retry',
  'invalid saved desktop preferences are preserved until an explicit reset',
  'short viewport keeps modal content scrollable and keyboard actions reachable',
  'compact layout exposes named modal validation and returns focus after cancellation',
  'boots BrowserOS, launches About, and closes with keyboard focus restored',
  'drags within the workspace, cancels with Escape, and keeps controls clickable',
  'offers keyboard move, cancellation and native modal focus containment',
  'supports keyboard resize with cancellation and focus return',
  'maximizes to workspace, keeps placement through minimize and restores original bounds',
  'Notes saves shared text, protects dirty close and retains content after reload',
  'Notes keeps local edits when another tab saves and resolves conflict explicitly',
  'CRLF editing preserves raw storage and reload; mixed endings require explicit conversion',
  'download contains saved tree/settings, excludes drafts and stays an immutable copy until re-prepared',
  'temporary workspace can be exported with keyboard on a narrow viewport',
  'retry after denied storage reaches the saved workspace without implicit memory',
  'orphaned contents block boot and are preserved',
  'a version change stops the active runtime and refuses an unsupported schema',
]

export default defineConfig({
  ...desktop,
  workers: 2,
  outputDir: 'test-results/cross-browser',
  testMatch: [
    'shell-menus.spec.ts',
    'accessibility.spec.ts',
    'boot.spec.ts',
    'window-move.spec.ts',
    'window-resize.spec.ts',
    'window-maximize.spec.ts',
    'notes.spec.ts',
    'editor-engine.spec.ts',
    'workspace-export.spec.ts',
    'storage-recovery.spec.ts',
    'workspace-boot.spec.ts',
  ],
  grep: new RegExp(
    scenarios
      .map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
  ),
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
