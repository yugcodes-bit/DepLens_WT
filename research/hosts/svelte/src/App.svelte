<script>
  import { orders } from './data.js';
</script>

<h1>Orders</h1>
<ul>
  {#each orders as o (o.id)}
    <li>#{o.id} · {o.customer} · ${o.total.toFixed(2)} · {o.status}</li>
  {/each}
</ul>
