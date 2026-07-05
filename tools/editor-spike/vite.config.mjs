import { defineConfig } from 'vite'
export default defineConfig({
  base: './',
  build: { manifest: true, assetsInlineLimit: 0 },
  worker: { format: 'es' },
})
