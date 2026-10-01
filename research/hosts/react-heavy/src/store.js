import { create } from 'zustand';
import { orders } from './data.js';

// A realistic client-side store: the app's data lives here, selected by components.
export const useStore = create(() => ({
  orders,
  totals: {
    count: orders.length,
    sum: orders.reduce((s, o) => s + o.total, 0),
  },
}));
