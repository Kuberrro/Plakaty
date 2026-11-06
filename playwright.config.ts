import { defineConfig } from '@playwright/test';

const PORT = 4188;
const BASE = '/plakaty-test/';

// Testy idą w zainstalowanym Chrome, w rozmiarze iPhone'a i pod ścieżką jak na GitHub Pages.
// To NIE jest Safari ani iPhone: patrz docs/TESTY-RECZNE.md.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    channel: 'chrome',
    baseURL: `http://localhost:${PORT}${BASE}`,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: false,
    env: { VITE_BASE_PATH: BASE, VITE_SUPABASE_URL: 'http://supabase.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  },
});
