import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app from /powder-lab/, the self-hosted deploy serves
// it from the domain root, and `npm run dev` wants the root too. VITE_BASE lets
// a deploy say which without editing this file.
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === 'build' ? '/powder-lab/' : '/'),
  plugins: [react()],
}))
