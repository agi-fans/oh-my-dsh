import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { target: 'esnext' },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 200_000,
  },
})
