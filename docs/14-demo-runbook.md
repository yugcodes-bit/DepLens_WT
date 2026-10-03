# 14 — Demo runbook

Exact commands, in order, with the output to expect. Written so the demo can be given from this
page without improvising, and so a failure mid-demo has an obvious cause.

Every number below was produced on 3 Oct 2026 on the dev laptop. Byte figures are reproducible
exactly; millisecond figures are predictions from the placeholder model and will match as long as
the model is unchanged. Timings (install/build seconds) vary with machine and npm cache.

---

## 0. Before the room fills

```bash
pnpm install
pnpm fixtures
pnpm typecheck && pnpm test          # 288 tests, ~1 min
```

Warm the npm cache for the packages the demo installs, so no step waits on the network:

```bash
pnpm harness analyze --host research/hosts/react \
  --pkg date-fns@4.1.0 --import "import { format } from 'date-fns'" > /dev/null
```

Start the stack in three terminals and leave them running:

```bash
pnpm db:serve        # A — local Postgres (PGlite behind a socket). Nothing to install.
pnpm db:migrate      # B — once; then:
pnpm web             # B — http://localhost:3000
pnpm worker --watch  # C — claims queued analyses
```

Check: `http://localhost:3000` returns the landing page, and terminal C prints
`tier-2 analysis worker — byte analysis only, no timing`.

---

## 1. The problem, in 30 seconds

Say it, don't demo it:

> Four date libraries. Bundlephobia tells you how big each one is. Nothing tells you what any of
> them will cost **your** app when it loads on a cheap Android phone. So people pick by size, or by
> GitHub stars.

Then the hook — two packages of **identical** size, measured by our own harness:

| What the code does | Extra main-thread time |
|---|---|
| 246 KB of functions that are never called | ≈ **0 ms** |
| The same 246 KB, each function called once at import | **32.4 ms** |

> Same bytes. Thirty-two milliseconds apart. Size cannot see the difference, because a JavaScript
> engine only fully compiles the code it actually runs.

(Source: `docs/research-log.md`, the `bytes-K` vs `eager-K` fixtures.)

---

## 2. The headline demo — context changes everything

This is the single most important thing to show. **The same import, two apps.**

```bash
pnpm harness analyze --host research/hosts/react \
  --pkg date-fns@4.1.0 --import "import { format } from 'date-fns'" \
  --profile mid-tier-mobile --budget-ms 50
```

Expect:

```
Δbytes         19918 min /    5695 gzip /    4946 br   [exact]
new pkgs    date-fns
ΔScript     9.5 ms [0.5, 23.7]   [predicted · b3-bytes-linear]
verdict     LOW: The whole interval stays under half the 50 ms budget.
```

Now the *same command* against an app that already ships date-fns:

```bash
pnpm harness analyze --host research/hosts/react-heavy \
  --pkg date-fns@4.1.0 --import "import { format } from 'date-fns'" \
  --profile mid-tier-mobile --budget-ms 50
```

Expect:

```
Δbytes           204 min /     -69 gzip /     276 br   [exact]
shared      date-fns (already in the app)
ΔScript     0.1 ms [0.0, 0.2]   [predicted · b3-bytes-linear]
why         Your app already ships 1 of the packages this import needs, saving 19 KB
advice      This adds a second copy of a package your app already has. Aligning the versions …
```

**19,918 B versus 204 B — 98× — for byte-identical source.** Say the number out loud.

Two things to point at:
- `[exact]` on the byte line: that is counted by differencing two real production builds, not
  estimated.
- The `advice` line about a duplicate version is a real finding: `react-heavy` pins a different
  date-fns, so the two copies ship together.

---

## 3. Comparing candidates — and refusing to over-claim

```bash
pnpm harness analyze --host research/hosts/react --profile mid-tier-mobile --budget-ms 50 \
  --pkg moment@2.30.1 --pkg dayjs@1.11.13 --pkg date-fns@4.1.0 --pkg luxon@3.5.0 \
  --import "import moment from 'moment'|||import dayjs from 'dayjs'|||import { format } from 'date-fns'|||import { DateTime } from 'luxon'"
```

Takes ~45 s. Expect exact byte deltas of **7,470 / 19,918 / 61,626 / 70,280 B** for
dayjs / date-fns / moment / luxon, and:

```
ranking (cheapest first, by predicted ΔScript):
  1. dayjs
  2. date-fns  = no clear difference from the one above
  3. moment  = no clear difference from the one above
  4. luxon  = no clear difference from the one above
```

**Do not hide the "no clear difference" lines — they are the best slide in the deck.** The honest
framing:

> Our placeholder model only knows about bytes. Its uncertainty intervals are so wide that they
> all overlap, so it refuses to rank them. That is the correct answer for a bytes-only predictor —
> and it is exactly why we need the measured dataset. Every size-based tool in the world draws you
> a confident bar chart here. Ours tells you it cannot tell.

Also show moment and luxon getting `UNCERTAIN — verify recommended`, and point out that the risk
level comes from the **interval**, not the point estimate (doc 01 §4.2, FR-24).

---

## 4. The web app

Browser, `http://localhost:3000`.

1. **Register** → the OTP is printed in terminal B and shown in the page (no mail provider in dev).
   Mention: Argon2id, server-side sessions in `httpOnly` cookies, hashed single-use OTP, CSRF
   double-submit plus origin check, a self-hosted CAPTCHA drawn as **vector strokes** so the answer
   is not in the markup for a bot to regex out.
2. **Dashboard → New analysis.** Click *Load the four date libraries*. Budget 50 ms, mid-tier
   mobile. Submit.
3. The results page shows a queue position, then progress from the worker in terminal C. Point at
   terminal C: *analysis does not run on the web server* — installing npm packages and running a
   bundler does not fit in a serverless function, so it is a Postgres-backed job queue and a
   separate worker. That is also what keeps the deployment on free tiers.
4. When it finishes: the **forest plot** (bars are intervals, dots are estimates, overlapping bars
   mean "cannot separate"), the per-candidate cards with **provenance badges** on every number, the
   "why" list, and the advice.
5. Expand **"Show the 78 features behind this"** on one card. This is the research artefact: every
   name comes from `feature-schema.json`, and the same file drives the Python pipeline.

If the queue stalls, `pnpm jobs` shows every job's status, worker and error in one line each.

---

## 5. The research machinery

Three things worth two minutes each.

**A. The measurement harness is honest about its own noise.**

```bash
pnpm harness machine     # the stored calibration curve and what each profile resolves to
pnpm harness noise       # A/A noise floor (MDE95) from stored sessions
```

> A device profile is a *calibrated slowdown*, not Chrome's throttling rate — the rate means
> different things on different machines. We measured rate 4 as 4.28× on this laptop idle and 8.4×
> loaded. A session whose calibration drifts more than 10 % from the machine's reference **aborts**
> rather than producing a number.

**B. A/A testing: we measure the instrument before we trust it.**

```bash
pnpm harness aa --host research/hosts/vanilla --profile desktop --pairs 10 --seed 11
```

The baseline measured against itself should produce a confidence interval containing zero. On a
quiet machine this harness resolves **1.26 ms**; on a loaded one it cannot see 4 ms. That is why
the dataset is blocked on hardware, and saying so is a strength, not an excuse.

**C. The ML pipeline is built, with the baselines it has to beat.**

```bash
pnpm ml:eval -- --synthetic
```

Point at the output, and be explicit:

> This is synthetic. It exists to prove the pipeline runs — splits, five baselines, the model,
> conformal intervals. The generator encodes our own hypothesis, so of course the model recovers
> it. `assert_real()` in the code refuses to let synthetic data reach a results table.

What to show in that output:
- **S1 is printed under `[DIAGNOSTIC ONLY, NOT A RESULT]`.** A random row split leaks package
  identity; reporting it as a headline is forbidden (hard rule 4). The honest split is S2 —
  no package in both train and test.
- **B4, "isolated measured cost"**, is the baseline that matters: measure the package on an empty
  app and reuse that number. If our context-aware model cannot beat B4, the whole framing adds
  nothing — and on the synthetic data B4 is genuinely competitive on S2. We report it either way.

---

## 6. Where it stands, said out loud

Do not oversell. The strongest version of this project is the honest one:

> The software is finished and tested — 433 test cases, ten packages, a deployed-ready web app.
> What is not finished is the dataset. Our own measurements showed that this laptop under load
> mis-resolves every device profile and cannot see a 4 ms difference, so collecting on it would
> produce numbers that look like data and are not. We need a quiet machine for roughly two days of
> measurement. Until then every millisecond in the product is labelled `predicted` and comes from
> a bytes-only placeholder, and every byte figure is labelled `exact` and is real.

Then the contribution, which does not depend on the dataset:

1. The **incremental, context-aware formulation** — cost of *this import* in *this app* — which no
   existing tool computes.
2. A **noise-quantified measurement protocol**: paired A/B, calibrated profiles, drift abort, A/A
   validation, with the noise floor reported rather than assumed.
3. An **83-feature schema** shared by the TypeScript extractors and the Python pipeline, with the
   contract enforced by tests on both sides.
4. **Provenance on every number** — `exact` / `measured` / `predicted` / `modelled` — so a reader
   always knows what kind of claim they are looking at.

---

## 7. If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| Analysis sits at "Waiting for a worker…" | no worker running | start `pnpm worker --watch` |
| `read ECONNRESET` from the database | more clients than the PGlite server allows | `DEPLENS_PG_MAX_CONNECTIONS=10 pnpm db:serve` (now the default) |
| `EPERM … .next/trace` | two `next dev` processes sharing `.next` | stop one |
| First web test run fails, second passes | Next dev compiles routes on first request | warm the routes, or run twice |
| `WARN Unsupported engine` | Node 20 installed, project wants ≥ 22 | harmless today; upgrade Node |
| `npm install produced no node_modules` | offline, or a package name typo | check the network and the `--pkg` spelling |
| A measurement session aborts on drift | the machine got busy | correct behaviour — close things and re-calibrate |

**Never** raise `--drift-tolerance` to make a demo work. It exists for smoke tests; a cell measured
past the drift abort is not data.
