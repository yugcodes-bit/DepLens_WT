// DepLens host app: Svelte 5. Deterministic render from mocked data (doc 07 §5).

/* @deplens-inject */
globalThis.__DL_SINK__ = [];
/* @deplens-end */

import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app') });
requestAnimationFrame(() => performance.mark('app-ready'));
