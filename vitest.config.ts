import { defineConfig } from 'vitest/config'

// dedicated vitest config (kept separate from vite.config.ts so the production
// `base` path never leaks into the test run). engine tests run in plain node
// with tiny canvas/ImageData shims from test/setup.ts.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts'],
  },
})
