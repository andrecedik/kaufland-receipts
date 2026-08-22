import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths so assets resolve correctly regardless of where
  // the built site is served from; HashRouter (see src/App.tsx) keeps
  // routing client-side with no server rewrite rules needed. Still requires
  // an HTTP server (see web/README.md) -- unlike the plain-HTML site/, this
  // can't be opened directly via file://.
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  build: {
    outDir: '../site-b',
    emptyOutDir: true,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
