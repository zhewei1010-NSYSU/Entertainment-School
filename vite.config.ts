import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync } from 'node:fs';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: root + 'pages-app',
  publicDir: root + 'public',
  base: './',
  plugins: [
    react(),
    { name: 'copy-public-data', closeBundle() {
      mkdirSync(root + 'dist', { recursive: true });
      cpSync(root + 'data', root + 'dist/data', { recursive: true });
      cpSync(root + 'favicon.svg', root + 'dist/favicon.svg');
    } },
    VitePWA({
      registerType: 'prompt', injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        id: './', name: '校園漫遊｜台灣國小探索地圖', short_name: '校園漫遊',
        description: '探索台灣國小，記錄自己的照片與走訪心得。',
        lang: 'zh-Hant', start_url: './', scope: './', display: 'standalone',
        theme_color: '#2b513e', background_color: '#f8f8f2',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}', 'data/**/*.json'],
        navigateFallback: 'index.html', cleanupOutdatedCaches: true,
        // Cache public map/catalogue snapshots only, never external map services or private photos.
        runtimeCaching: [],
      },
    }),
  ],
  css: { postcss: root },
  build: { outDir: root + 'dist', emptyOutDir: true },
});
