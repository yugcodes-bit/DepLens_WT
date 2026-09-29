# Phase 0 validation report

- Generated: 2026-09-28T17:26:42.211Z
- Pairs per session: 10 (+1 warm-up)
- Environment: {"chromium":"141.0.7390.37","cpu":"Intel(R) Xeon(R) Processor @ 2.10GHz","cpus":2,"platform":"linux 6.18.44-fc-v37"}

## E2 — A/A noise

| session | cpu | ΔScript thread ms | ΔScript wall ms | ΔTBT ms | ΔMainThread ms |
|---|---|---|---|---|---|
| A/A seed11 | 1× | 0.6 [-0.3, 1.6] | 0.7 [-1.6, 2.8] | 0.0 [0.0, 0.0] | 0.6 [-2.4, 8.1] |
| A/A seed12 | 1× | -0.6 [-1.8, 0.8] | -1.1 [-2.8, 0.4] | 0.0 [0.0, 0.0] | -1.6 [-6.1, 3.0] |
| A/A seed11 | 4× | -8.9 [-17.5, -2.1] | -8.3 [-15.5, -1.1] | -4.8 [-7.8, 0.0] | -9.1 [-27.2, 7.4] |
| A/A seed12 | 4× | -2.3 [-11.3, 5.6] | -5.5 [-15.3, 5.7] | -3.5 [-12.2, 1.2] | -13.2 [-28.8, 11.4] |

## E3 — injected cost at 1× (1 unit = 100k loop iterations)

| fixture | Δmin bytes | ΔScript thread ms | ΔScript wall ms | ΔTBT ms |
|---|---|---|---|---|
| work-0 | 67 | 1.6 [-0.1, 2.9] | 1.5 [0.4, 3.4] | 0.0 [0.0, 0.0] |
| work-1 | 67 | 2.9 [1.4, 4.1] | 2.1 [0.3, 4.0] | 0.0 [0.0, 0.0] |
| work-2 | 67 | 2.4 [0.8, 3.8] | 2.8 [-0.3, 5.1] | 0.0 [0.0, 0.0] |
| work-5 | 67 | 3.2 [2.6, 3.7] | 4.0 [2.6, 5.3] | 0.0 [0.0, 0.0] |
| work-10 | 68 | 3.3 [2.1, 4.2] | 3.2 [0.3, 5.2] | 0.0 [0.0, 0.0] |
| work-20 | 68 | 4.3 [3.5, 5.1] | 5.6 [3.4, 6.9] | 0.0 [0.0, 0.0] |
| work-50 | 68 | 9.0 [7.9, 9.8] | 9.1 [7.9, 11.8] | 0.0 [0.0, 0.0] |
| work-100 | 69 | 17.9 [16.8, 19.1] | 20.4 [16.8, 23.5] | 0.0 [0.0, 0.0] |

Linear fit (thread): ΔScript = 1.93 + 0.155·units, R² = 0.9887
Linear fit (wall):   ΔScript = 1.94 + 0.177·units, R² = 0.9797

## E3 — injected cost at 4× (1 unit = 100k loop iterations)

| fixture | Δmin bytes | ΔScript thread ms | ΔScript wall ms | ΔTBT ms |
|---|---|---|---|---|
| work-0 | 67 | 3.5 [-10.9, 7.1] | 3.9 [-11.2, 8.0] | 0.0 [-7.1, 4.5] |
| work-5 | 67 | 13.7 [1.0, 24.0] | 15.8 [3.0, 24.9] | 1.5 [-6.1, 13.5] |
| work-20 | 68 | 19.0 [8.5, 31.3] | 18.8 [8.9, 28.6] | 5.1 [-4.1, 15.6] |
| work-50 | 68 | 30.5 [21.2, 41.4] | 31.1 [22.1, 41.6] | 11.5 [2.0, 21.0] |
| work-100 | 69 | 70.3 [59.3, 78.7] | 72.4 [59.6, 81.3] | 48.3 [36.4, 54.7] |

Linear fit (thread): ΔScript = 5.72 + 0.619·units, R² = 0.9724
Linear fit (wall):   ΔScript = 6.37 + 0.629·units, R² = 0.9640

## E1 — throttling behaviour

Slope ratio 4×/1× — thread time: **3.99**, wall time: **3.56** (expected ≈ 4 if the metric reflects throttling).

## E4 — bytes never executed vs executed once (1×)

| fixture | Δmin bytes | ΔScript thread ms | compile ms | eval ms |
|---|---|---|---|---|
| bytes-0 | 10 | -0.4 [-1.2, -0.0] | -0.3 [-1.0, -0.0] | -0.0 [-0.2, 0.1] |
| eager-0 | 35 | 0.3 [-0.5, 1.1] | 0.3 [-0.4, 0.9] | 0.0 [-0.2, 0.2] |
| bytes-50 | 29578 | 0.5 [-0.2, 1.4] | 0.4 [-0.1, 1.2] | 0.1 [-0.1, 0.3] |
| eager-50 | 29605 | 3.5 [2.7, 4.0] | 3.1 [2.5, 3.5] | 0.4 [0.2, 0.5] |
| bytes-100 | 59765 | 0.3 [-0.1, 2.0] | 0.1 [-0.1, 1.6] | 0.1 [-0.1, 0.4] |
| eager-100 | 59792 | 7.9 [6.8, 8.7] | 6.8 [6.0, 7.7] | 1.0 [0.8, 1.1] |
| bytes-200 | 120492 | 0.5 [0.0, 1.1] | 0.3 [0.1, 1.0] | 0.1 [-0.0, 0.2] |
| eager-200 | 120519 | 15.4 [12.7, 17.9] | 12.3 [11.2, 15.3] | 2.2 [1.5, 3.5] |
| bytes-400 | 246363 | -0.4 [-1.2, 0.4] | -0.6 [-1.4, 0.1] | 0.1 [-0.0, 0.3] |
| eager-400 | 246390 | 32.4 [27.0, 37.3] | 27.5 [23.6, 31.2] | 4.7 [3.4, 5.9] |

## E5 — real packages at 4× (vanilla host)

| import | Δmin bytes | Δbrotli bytes | ΔScript thread ms | ΔTBT ms | ΔHeap MB |
|---|---|---|---|---|---|
| lodash-es {debounce} | 2391 | 1005 | 1.5 [-1.7, 4.0] | 0.7 [-1.7, 2.6] | 0.00 |
| lodash/debounce | 3450 | 1396 | 7.2 [4.1, 13.0] | 0.8 [-0.2, 5.7] | 0.01 |
| dayjs | 7707 | 3039 | 4.5 [-0.8, 12.1] | 0.0 [-1.3, 3.0] | 0.02 |
| date-fns {format} | 19848 | 5062 | 1.2 [-4.2, 6.1] | -0.7 [-4.1, 1.9] | 0.05 |
| moment | 61666 | 18128 | 22.6 [17.0, 30.5] | 3.6 [0.0, 11.3] | 0.20 |
| luxon {DateTime} | 69225 | 19160 | -4.3 [-8.5, 1.1] | -3.1 [-5.9, -0.1] | 0.16 |
| lodash (default) | 73095 | 23625 | 117.2 [110.1, 141.6] | 93.6 [86.1, 111.5] | 0.85 |
| date-fns (namespace) | 75306 | 16210 | 3.2 [-4.8, 8.1] | -5.4 [-11.1, 0.0] | 0.28 |

> Measured on the build container (2 shared vCPUs, cloud VM). This violates doc 07 §3.1 on purpose: it is a functional spike, not a dataset. Re-run on the dedicated measurement machine.
