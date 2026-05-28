import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// On GitHub Pages the app is served from /powder-lab/, but locally we want
// it at the root, so only apply the base path for production builds.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/powder-lab/' : '/',
  plugins: [react()],
}))
