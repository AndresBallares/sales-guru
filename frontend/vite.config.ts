/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules', 'dist', 'e2e'],
    coverage: {
      provider: 'v8',
      // Vitest 4 has no default `include`: without this, a source file no test
      // imports is silently left out of the report instead of counting as 0%.
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/test/',
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        'e2e/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
})
