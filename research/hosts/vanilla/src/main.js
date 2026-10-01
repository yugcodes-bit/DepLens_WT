// DepLens host app: vanilla JS. Deterministic render from mocked data, no network, no randomness.
// Contract (doc 07 §5): injection marker at top level of the entry + performance.mark('app-ready') after first render.

/* @deplens-inject */
globalThis.__DL_SINK__ = [];
/* @deplens-end */

import { orders } from './data.js';

function render() {
  const list = document.getElementById('list');
  const frag = document.createDocumentFragment();
  for (const o of orders) {
    const li = document.createElement('li');
    li.textContent = `#${o.id} · ${o.customer} · $${o.total.toFixed(2)} · ${o.status}`;
    frag.appendChild(li);
  }
  list.appendChild(frag);
}

render();
requestAnimationFrame(() => performance.mark('app-ready'));
