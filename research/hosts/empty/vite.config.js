import { defineConfig } from 'vite';

// Isolated host: no framework plugin, nothing but the injected import.
export default defineConfig({
  build: { target: 'es2022', minify: 'esbuild', modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
});
