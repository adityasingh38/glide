import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { minify: 'esbuild' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { minify: 'esbuild' }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          suggestion: resolve(__dirname, 'src/renderer/suggestion.html')
        }
      }
    }
  }
})
