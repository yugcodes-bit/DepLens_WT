# DepLens

**Know what an npm package will cost *your* app — before you add it.**

DepLens predicts the extra main-thread time, blocking time and bytes that a specific import of a candidate package will add to a specific web app on a chosen device profile, with an uncertainty range, an explanation and cheaper alternatives — and verifies the prediction with a paired A/B measurement in headless Chromium on demand.

> **Status:** the software pipeline is built and tested end to end (433 test cases); the measurement
> dataset is not collected yet, so every millisecond figure is labelled `predicted` and comes from a
> bytes-only placeholder, while every byte figure is labelled `exact` and is real.
> **[`STATUS.md`](STATUS.md)** is the project tracker. [`docs/`](docs/README.md) has the full design;
> [`docs/14-demo-runbook.md`](docs/14-demo-runbook.md) is the demo script.

## Quick start

```bash
pnpm install
pnpm fixtures

# Static analysis — no browser, no database. ~15 s.
pnpm harness analyze --host research/hosts/react   --pkg date-fns@4.1.0 --import "import { format } from 'date-fns'"   --profile mid-tier-mobile --budget-ms 50
```

### Why this is not a size tool

The same import, on two apps, measured by the pipeline above:

| Host app | `import { format } from 'date-fns'` | Why |
|---|---|---|
| `react` (222 KB baseline) | **+19,918 B** | date-fns is new to the app |
| `react-heavy` (411 KB baseline) | **+204 B** | the app already ships date-fns |

98× apart for byte-identical source. And size cannot see runtime cost at all: two of our fixtures
hold the *same* 246 KB of code, one calling its functions at import and one not — ≈0 ms versus
**32.4 ms** of main-thread time.

```bash
# The web app: accounts, analysis UI, results with provenance badges.
pnpm db:serve     # terminal A — local Postgres, nothing to install
pnpm db:migrate   # terminal B — once
pnpm web          # terminal B — http://localhost:3000
pnpm worker --watch  # terminal C — runs queued analyses

pnpm test && pnpm test:ml && pnpm typecheck
```

## Documents
Start with [docs/README.md](docs/README.md).

## License
TBD by the team (MIT suggested for code; CC BY 4.0 for the measurement dataset).
