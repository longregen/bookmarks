import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@hono/hono/cors': path.resolve(__dirname, 'server/node_modules/hono/dist/middleware/cors/index.js'),
      '@hono/hono/logger': path.resolve(__dirname, 'server/node_modules/hono/dist/middleware/logger/index.js'),
      '@hono/hono': path.resolve(__dirname, 'server/node_modules/hono/dist/index.js'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e.test.ts', 'tests/e2e-*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
      ],
    },
  },
});
