import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: { target: 'es2022', minify: 'esbuild', modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
});
