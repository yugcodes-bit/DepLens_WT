// DepLens host app: React. Deterministic render from mocked data (doc 07 §5).

/* @deplens-inject */
globalThis.__DL_SINK__ = [];
/* @deplens-end */

import { createRoot } from 'react-dom/client';
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

createRoot(document.getElementById('app')).render(<App />);
requestAnimationFrame(() => performance.mark('app-ready'));
