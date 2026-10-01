import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022', minify: 'esbuild', modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
});
