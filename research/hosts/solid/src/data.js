// Deterministic mocked data (doc 07 §5): no Math.random, no Date.now, no network.
export const orders = Array.from({ length: 40 }, (_, i) => ({
  id: 1000 + i,
  customer: `Customer ${i + 1}`,
  total: ((i * 37) % 500) + 0.99,
  status: ["new", "paid", "shipped", "done"][i % 4],
}));
