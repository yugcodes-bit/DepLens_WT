// DepLens host app: Vue 3. Deterministic render from mocked data (doc 07 §5).

/* @deplens-inject */
globalThis.__DL_SINK__ = [];
/* @deplens-end */

import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
requestAnimationFrame(() => performance.mark('app-ready'));
