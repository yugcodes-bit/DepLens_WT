# DepLens

**Know what an npm package will cost *your* app — before you add it.**

DepLens predicts the extra main-thread time, blocking time and bytes that a specific import of a candidate package will add to a specific web app on a chosen device profile, with an uncertainty range, an explanation and cheaper alternatives — and verifies the prediction with a paired A/B measurement in headless Chromium on demand.

> Status: Phase 0 (measurement harness spike). See [`docs/`](docs/README.md) for the full project definition, literature review, SRS, architecture, methodology and roadmap.

## Quick start (harness)
```bash
pnpm install
pnpm fixtures
pnpm --filter @deplens/harness test
pnpm harness run --import "import dayjs from 'dayjs'" --dep dayjs@1.11.13 --cpu 4 --pairs 10
```
Phase 0 spike results (build container, noisy — see `research/experiments/results/`): four imports of similar size (62–75 KB minified) added between ≈ 0 ms (luxon `{DateTime}`, date-fns namespace) and **+117 ms** (lodash default import) of main-thread script time at 4× CPU slowdown in the same app. Bytes alone don't tell you the cost.

## Documents
Start with [docs/README.md](docs/README.md).

## License
TBD by the team (MIT suggested for code; CC BY 4.0 for the measurement dataset).
