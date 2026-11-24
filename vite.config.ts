import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The page is built into dist/web and served by the pitcrew server.
// `npm run dev:web` proxies the API to a running `pitcrew --no-open` on port 4747.
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:4747', changeOrigin: true } } },
})
