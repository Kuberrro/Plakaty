import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Na GitHub Pages aplikacja działa pod /nazwa-repozytorium/ (ustawia to workflow).
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // aktualizacja na żądanie: nie przerywamy wpisywania wizyty
      injectRegister: false,
      includeAssets: ['ikona-180.png', 'szablony/*'],
      manifest: {
        name: 'Plakaty',
        short_name: 'Plakaty',
        description: 'Plan i rejestr rozwieszania plakatów',
        lang: 'pl',
        display: 'standalone',
        start_url: './',
        scope: './',
        theme_color: '#14532d',
        background_color: '#ffffff',
        icons: [
          { src: 'ikona-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'ikona-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'ikona-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache obejmuje WYŁĄCZNIE pliki interfejsu. Celowo brak runtimeCaching:
        // żadnych kafelków mapy, odpowiedzi Supabase ani Overpass.
        globPatterns: ['**/*.{js,css,html,png,svg,csv,geojson,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
  },
});
