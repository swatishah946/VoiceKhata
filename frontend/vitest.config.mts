import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Setup follows node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/unit/setup.ts'],
    env: { TZ: 'UTC' }, // run as if the viewer's computer is NOT in India: dates must still be IST
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/components/**', 'src/app/**/page.tsx', 'src/app/dashboard/layout.tsx'],
      reporter: ['text', 'json-summary'],
      thresholds: { statements: 85, branches: 75, functions: 80, lines: 88 },
    },
  },
});
