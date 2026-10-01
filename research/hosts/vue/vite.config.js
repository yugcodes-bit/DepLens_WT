import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: { target: 'es2022', minify: 'esbuild', modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
});
