// DepLens host app: Preact. Deterministic render from mocked data (doc 07 §5).

/* @deplens-inject */
globalThis.__DL_SINK__ = [];
/* @deplens-end */

import { render } from 'preact';
import { orders } from './data.js';

function App() {
  return (
    <>
      <h1>Orders</h1>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>
            #{o.id} · {o.customer} · ${o.total.toFixed(2)} · {o.status}
          </li>
        ))}
      </ul>
    </>
  );
}

render(<App />, document.getElementById('app'));
requestAnimationFrame(() => performance.mark('app-ready'));
