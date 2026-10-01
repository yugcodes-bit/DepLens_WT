// Deterministic mocked data (doc 07 §5): no Math.random, no Date.now, no network.
// The "date" is a fixed epoch so date formatting is deterministic across runs.
const EPOCH = Date.UTC(2026, 0, 15, 9, 30, 0);

export const orders = Array.from({ length: 60 }, (_, i) => ({
  id: 1000 + i,
  customer: `Customer ${i + 1}`,
  total: ((i * 37) % 500) + 0.99,
  status: ['new', 'paid', 'shipped', 'done'][i % 4],
  placedAt: new Date(EPOCH + i * 3_600_000),
}));
