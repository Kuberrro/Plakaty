import { defineConfig } from 'vitest/config';

// Uruchamiane wyłącznie przez scripts/test-rls.mjs (przy ustawionym POSTGREST_BIN).
export default defineConfig({
  test: { include: ['tests/integration/**/*.test.ts'], environment: 'node', setupFiles: ['tests/unit/setup.ts'], testTimeout: 30_000 },
});
