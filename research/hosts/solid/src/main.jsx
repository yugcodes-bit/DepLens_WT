// DepLens host app: Solid. Deterministic render from mocked data (doc 07 §5).

/* @deplens-inject */
globalThis.__DL_SINK__ = [];
/* @deplens-end */

import { render } from 'solid-js/web';
import { For } from 'solid-js';
import { orders } from './data.js';

function App() {
  return (
    <>
      <h1>Orders</h1>
      <ul>
        <For each={orders}>
          {(o) => (
            <li>
              #{o.id} · {o.customer} · ${o.total.toFixed(2)} · {o.status}
            </li>
          )}
        </For>
      </ul>
    </>
  );
}

render(() => <App />, document.getElementById('app'));
requestAnimationFrame(() => performance.mark('app-ready'));
