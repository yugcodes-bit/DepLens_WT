<script setup>
import { orders } from './data.js';
</script>

<template>
  <h1>Orders</h1>
  <ul>
    <li v-for="o in orders" :key="o.id">#{{ o.id }} · {{ o.customer }} · ${{ o.total.toFixed(2) }} · {{ o.status }}</li>
  </ul>
</template>
