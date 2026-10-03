# 05 — Software Requirements Specification (SRS)

Structure follows ISO/IEC/IEEE 29148 (successor of IEEE 830). Requirement IDs are stable — reference them in commits, tests and the paper's artifact appendix.

## 1. Introduction

### 1.1 Purpose
Specifies the requirements of **DepLens**, a web application, API and CLI that predicts — and on demand measures — the incremental browser-performance cost of adding an npm dependency to a specific web application; and of the **offline research pipeline** that produces its training data and model.

### 1.2 Scope
- **DepLens App** (Next.js web UI), **DepLens API** (Node/Fastify), **Workers** (build/analyze, measure), **ML Service** (FastAPI), **CLI**.
- **Research Pipeline:** corpus curation, host apps, measurement campaigns, dataset export, model training/evaluation.
- Out of scope: see doc 01 §7.

### 1.3 Definitions
See doc 01 §10 (host, candidate, import spec, profile, cell, session, sink, noise floor, hybrid model). Additional: **Quick mode** (analysis from `package.json` + lockfile only), **Full mode** (analysis from a buildable Vite project).

### 1.4 References
Docs 01–04, 06–08 of this repository; ISO/IEC/IEEE 29148:2018; Chrome DevTools Protocol docs; Lighthouse throttling docs.

## 2. Overall description

### 2.1 Product perspective
New, standalone system. Integrates with: npm registry (metadata/tarballs), a sandboxed package installer, esbuild/Vite, Playwright-driven Chromium via CDP, PostgreSQL, Redis, object storage (local disk or MinIO), e18e `module-replacements` data.

### 2.2 Product functions (summary)
PF-1 accept a host project and candidates · PF-2 build baseline/treatment and compute exact Δbytes · PF-3 extract features · PF-4 predict with intervals · PF-5 explain and advise · PF-6 compare alternatives · PF-7 verify by measurement · PF-8 CLI · PF-9 research pipeline (collect, label, train, evaluate) · PF-10 model card and dataset export.

### 2.3 User classes
| Class | Description | Frequency | Key needs |
|---|---|---|---|
| UC-Dev | Frontend developer | occasional, at decision time | fast answer, clear verdict, alternatives |
| UC-Lead | Tech lead / perf owner | occasional | budgets, CI integration, trust |
| UC-Res | Team researchers | daily during project | reproducible campaigns, dataset, experiments |
| UC-Admin | Operator | rare | deploy, monitor queues, rotate models |

### 2.4 Operating environment
- Server: Linux x86-64, Docker ≥ 24, Node.js 22 LTS, Python 3.11+, PostgreSQL 16, Redis 7, Chromium as bundled with the pinned Playwright version.
- **Measurement host:** dedicated, idle machine (desktop or bare-metal preferred; not a shared cloud VM) — see NFR-REP.
- Client: evergreen desktop browsers (Chrome, Firefox, Safari, Edge — last 2 versions).

### 2.5 Design & implementation constraints
- C-1 Candidate packages are **untrusted code**: install with `--ignore-scripts`, build/measure inside containers without credentials, with CPU/memory/time limits.
- C-2 Only one measurement session may run per measurement core-set at a time (noise control).
- C-3 A single **feature schema** file is the source of truth for feature names/types in TS and Python.
- C-4 MVP builds support Vite projects (Full mode) and lockfile-only analysis (Quick mode).
- C-5 Chromium version, Playwright version, and all flags are pinned per dataset release.

### 2.6 Assumptions & dependencies
- A-1 npm registry is reachable (or a local mirror/cache such as Verdaccio is provided).
- A-2 Host apps used for training can be built offline with mocked data.
- A-3 Labels from lab emulation are an acceptable proxy for device cost within stated limits (validated on a subset).

## 3. External interface requirements

### 3.1 User interface
- UI-1 **New Analysis** page: project input (tabs: *Quick — paste/upload package.json + lockfile*, *Full — upload zip or Git URL*), candidate list (1–5) each with version and import-spec editor (CodeMirror, JS syntax), profile select, optional budget (ms, KB).
- UI-2 **Results** page: one card per candidate with ΔScript point + interval bar, ΔTBT, Δbytes (exact/estimated badge), Δnetwork (modeled), risk chip, verdict, top-5 "why", advice list, *Verify* button; live progress via SSE.
- UI-3 **Compare** view: ranked table + forest plot of intervals; "difference within noise" markers.
- UI-4 **Verification** view: measured vs predicted, per-run distributions (A vs B), breakdown bars, reproducibility metadata.
- UI-5 **Model card** page; UI-6 (COULD) **Cost explorer**.
- UI-7 Accessibility: WCAG 2.1 AA for contrast, keyboard navigation, labels; charts have text equivalents.

### 3.2 API (REST, JSON, versioned `/api/v1`, OpenAPI 3.1 generated)
| Method & path | Purpose |
|---|---|
| `POST /projects` | create a project from manifest+lockfile (Quick) or archive/Git URL (Full) → `projectId` |
| `POST /analyses` | `{projectId, candidates[{name, version?, import?, placement?}], profile, budget?}` → `202 {analysisId}` |
| `GET /analyses/:id` | status + results |
| `GET /analyses/:id/events` | Server-Sent Events: `queued · resolving · building · extracting · predicting · done · error` |
| `POST /analyses/:id/candidates/:idx/verify` | enqueue measurement → `202 {sessionId}` |
| `GET /sessions/:id` | measurement status/result |
| `GET /packages/:name/alternatives` | e18e + curated alternative groups |
| `GET /profiles` | profile presets + calibration metadata |
| `GET /models/current` | model version, metrics, card |
| `POST /cli/predict` | features computed locally by CLI → prediction (no source upload) |

ML service (internal): `POST /predict {schemaVersion, rows[]}` → `{point, p10, p90, contributions[]}` per row; `GET /health`; `GET /model`.

### 3.3 Software interfaces
npm registry HTTP API; Playwright (Chromium) + CDP domains `Tracing`, `Emulation`, `Network`, `Performance`, `Runtime`; esbuild JS API; Vite build API; PostgreSQL; Redis (BullMQ); S3-compatible storage.

### 3.4 Hardware interfaces
Optional: one Android device via USB (adb) for the real-device validation subset.

## 4. Functional requirements

Priority: **M** must · **S** should · **C** could. Each FR has an acceptance criterion (AC).

### 4.1 Project intake
| ID | Requirement | P | Acceptance criterion |
|---|---|---|---|
| FR-01 | Accept Quick-mode input (package.json + npm/pnpm/yarn lockfile) and parse the resolved dependency graph | M | Given the 3 lockfile formats from `fixtures/lockfiles`, the resolved package@version set matches the reference JSON exactly |
| FR-02 | Accept Full-mode input (zip ≤ 50 MB or public Git URL) and detect a Vite build | M | Fixture Vite projects are detected; non-Vite projects are rejected with a clear message and fall back to Quick mode |
| FR-03 | Detect host framework (React, Vue, Svelte, Preact, Solid, vanilla) and entry module | M | Correct on all host apps in `fixtures/host-apps` |
| FR-04 | Never execute install scripts; install in an isolated container with resource limits | M | A test package with a malicious `postinstall` does not run it (sentinel file absent) |

### 4.2 Build & bundle analysis
| ID | Requirement | P | AC |
|---|---|---|---|
| FR-10 | Build baseline and treatment; treatment differs only by injected import + sink | M | Byte-diff of entry sources shows only the injected lines; baseline contains the empty sink |
| FR-11 | Compute exact Δbytes (min, gzip-9, brotli-11) for the initial load | M | Matches an independent computation on fixture cases within 0 bytes |
| FR-12 | List modules/packages added, packages already present (shared), duplicate versions introduced | M | Correct on curated fixture cases (e.g., a React component lib in a React host shows `react` as shared) |
| FR-13 | Compute isolated bundle features (candidate alone, peers external) | M | Deterministic across 3 repeated runs |
| FR-14 | Support placement `lazy` (import() in a lazy chunk) | C | Initial-chunk Δbytes ≈ 0 and lazy chunk contains the package |
| FR-15 | Import-form advisor: evaluate alternative import forms (named, deep path, `-es` variant) and report Δbytes for each | S | For `lodash`/`debounce` the advisor lists `lodash/debounce` and `lodash-es` with smaller Δbytes |
| FR-16 | Cache builds by content hash (host lock hash + candidate@version + import) | S | Second identical request skips the build (log shows cache hit) |

### 4.3 Features, prediction, explanation
| ID | Requirement | P | AC |
|---|---|---|---|
| FR-20 | Extract the feature vector defined by `feature-schema.json` (version-stamped) | M | Schema validation passes; Python and TS agree on names/types (contract test) |
| FR-21 | Predict ΔScript point + p10/p90 for the chosen profile | M | Returns for every valid request; interval coverage on the held-out calibration set within ±5 pts of nominal |
| FR-22 | Predict ΔTBT (ML and analytic task-merging model; report the better one per model card) | S | Both computed in evaluation; UI shows the selected one |
| FR-23 | Return per-feature contributions (TreeSHAP) and group them into ≤ 5 plain-language reasons | M | Contributions sum to prediction − base value (±1e-6 in transformed space) |
| FR-24 | Risk & verdict rules from interval vs budget (doc 01 §4.2) | M | Unit tests cover all four risk classes |
| FR-25 | Mark requests out of the training distribution (e.g., framework not in training, Δbytes beyond max seen) | S | OOD flag shown; risk forced to "uncertain" |
| FR-26 | Compare mode: rank 2–5 candidates by predicted ΔScript; flag pairs whose intervals overlap by > 50% as "no clear difference" | M | Ranking and flags correct on synthetic inputs |
| FR-27 | Alternative suggestions from e18e manifests + curated groups | S | For `moment` suggests `dayjs`, `date-fns`, native `Intl` (as listed in the data) |

### 4.4 Verification (measurement)
| ID | Requirement | P | AC |
|---|---|---|---|
| FR-30 | Run a paired, interleaved A/B session (k pairs, randomized order in each pair) in headless Chromium with the profile's CPU throttling | M (research) / S (UI) | Session produces k valid pairs or reports failures per run |
| FR-31 | Parse traces into per-run metrics (compile, evaluate, GC, style/layout, long tasks, TBT, FCP, LCP, heap) | M | Parser matches hand-checked values on 3 golden traces |
| FR-32 | Estimate Δ with Hodges–Lehmann and bootstrap 95% CI; store label + noise | M | Unit tests on synthetic distributions with known shift |
| FR-33 | Run calibration benchmark at session start; abort if drift > 10% from machine baseline | M | Injected CPU load triggers abort |
| FR-34 | Detect invalid treatments (runtime errors, missing module, bytes Δ = 0) and label cell "invalid" | M | Node-only package (uses `fs`) is labelled invalid, not measured as 0 |
| FR-35 | Store raw traces (compressed) and all reproducibility metadata | M | Session record contains Chromium/Playwright versions, flags, machine id, calibration score, host commit |

### 4.5 CLI
| ID | Requirement | P | AC |
|---|---|---|---|
| FR-40 | `deplens check <pkg>[@ver] [--import "<code>"] [--profile] [--budget]` runs build + features locally, calls `/cli/predict` | S | Works offline except the predict call; prints table + JSON (`--json`) |
| FR-41 | `deplens compare <pkgA> <pkgB> …` | S | Ranked output |
| FR-42 | Exit code 1 when verdict is "over budget" (CI use) | C | Tested in a sample GitHub workflow |

### 4.5b Accounts, authentication & authorization (course-mandated — doc 04 §2.1)

| ID | Requirement | P | AC |
|---|---|---|---|
| FR-60 | Register with email + password; password stored only as an **Argon2id** hash (never reversible) | M | The `users` row contains no plaintext or decryptable password; a wrong password is rejected |
| FR-61 | Email ownership verified by a **6-digit OTP** sent to the address, valid 10 min, single use, max 5 attempts | M | An unverified account cannot sign in; a reused or expired OTP is rejected with a distinct message |
| FR-62 | Login creates a **server-side session**; the browser receives only an opaque session id in an `httpOnly`, `Secure`, `SameSite=Lax` cookie | M | The cookie contains no user data; deleting the session row immediately invalidates the cookie |
| FR-63 | Sessions expire after 7 days idle / 30 days absolute, and are rotated on privilege change | M | An expired session is rejected; the old id stops working after rotation |
| FR-64 | Logout deletes the server-side session and clears the cookie; "log out everywhere" deletes all of the user's sessions | M | After logout the same cookie value is refused |
| FR-65 | **CAPTCHA** on register, login and password-reset forms | M | A submission without a valid CAPTCHA token is rejected before any password check |
| FR-66 | Rate limiting and lockout: 5 failed logins per account per 15 min, then a timed lock; per-IP limits on all auth endpoints | M | The 6th attempt is refused even with the correct password |
| FR-67 | **Role-based authorization** — `user` (own projects), `researcher` (campaigns, dataset export), `admin` (queues, roles). Enforced **server-side on every request**, not only in the UI | M | A `user` calling a researcher-only endpoint gets 403 regardless of what the UI shows |
| FR-68 | A user can read and modify only their own projects and analyses | M | Requesting another user's project id returns 404, not 403 (no existence leak) |
| FR-69 | Password reset by emailed single-use token (30 min), which invalidates all existing sessions | S | The token cannot be reused; old sessions stop working |
| FR-70 | **Sensitive data encrypted at rest** beyond hashing: OTP codes and reset tokens stored as hashes; uploaded project archives encrypted with a server key | M | The database contains no usable OTP, token or archive plaintext |
| FR-71 | CSRF protection on every state-changing request (double-submit token or origin check) | M | A cross-origin POST with a valid session cookie is rejected |
| FR-72 | **Audit log** of register, login, failed login, logout, password change, role change, verification-quota hit | S | Each event records user, timestamp, IP and outcome |
| FR-73 | Account deletion removes personal data and anonymises any contributed measurements | S | The user row is gone; contributed sessions remain but carry no identifying field |

### 4.5c Input validation (course-mandated — doc 04 §2.1)

Validation runs **on both sides** from one shared Zod schema: in the browser for feedback, and again on
the server, which is the only one that is trusted (C-1).

| ID | Requirement | P | AC |
|---|---|---|---|
| FR-74 | **Required-field** validation on every form | M | Submitting an empty required field shows a field-level message and sends no request |
| FR-75 | **Email-format** validation | M | `a@b` and `a b@c.com` are rejected; `a@b.co` is accepted |
| FR-76 | **Compare** validation — password and confirm-password must match; password ≥ 10 chars with a strength check | M | A mismatch is reported on the confirm field |
| FR-77 | **Range** validation — budget 1–10,000 ms, 1–10,000 KB; pairs 4–40; candidates 1–5 | M | Out-of-range values are rejected with the permitted range in the message |
| FR-78 | **Number** validation — numeric fields reject non-numeric and non-finite input | M | `12a`, `NaN`, `1e400` are all rejected |
| FR-79 | **Custom** validation — the import spec must parse as one or more ES import declarations, and the package name must be a valid npm name | M | `import {` is rejected with a syntax message; `../evil` is rejected as not an npm package |
| FR-80 | Validation errors are announced accessibly (`aria-invalid`, `aria-describedby`, focus moved to the first error) | S | Screen-reader and keyboard-only paths reach every error message |

### 4.6 Research pipeline
| ID | Requirement | P | AC |
|---|---|---|---|
| FR-50 | Corpus builder: fetch candidate lists (download counts, categories), apply inclusion/exclusion rules, store with reasons | M | Reproducible from a seed file; exclusion reasons recorded |
| FR-51 | Campaign runner: schedule cells (host × import spec × profile), resume after crash, never run two sessions concurrently on the same core set | M | Killing the runner mid-campaign and restarting loses ≤ 1 session |
| FR-52 | A/A sessions for every host at the start and end of each campaign day | M | Noise-floor report generated automatically |
| FR-53 | Dataset export to Parquet with a data dictionary and hash | M | `make dataset` produces identical hash from the same DB snapshot |
| FR-54 | Training/evaluation scripts reproduce all paper tables from the exported dataset with fixed seeds | M | `make paper-tables` regenerates tables bit-identically (up to float formatting) |
| FR-55 | Model registry: versioned artifacts with metrics, dataset hash, git SHA | M | `/models/current` exposes them |

## 5. Non-functional requirements

### 5.1 Performance (of DepLens itself)
| ID | Requirement |
|---|---|
| NFR-P1 | Quick-mode analysis of one candidate: p95 ≤ 20 s cold, ≤ 3 s cached |
| NFR-P2 | Full-mode analysis of one candidate on a small Vite app: p95 ≤ 60 s cold (dominated by install/build) |
| NFR-P3 | ML inference: ≤ 50 ms per row including SHAP |
| NFR-P4 | Verification session (k = 10 pairs, mid-tier profile): ≤ 3 min |
| NFR-P5 | DepLens's own UI must pass its own medicine: initial JS ≤ 150 KB brotli, Lighthouse performance ≥ 90 on the results page |

### 5.2 Reproducibility & measurement quality (research-critical)
| ID | Requirement |
|---|---|
| NFR-REP1 | Every label is traceable to raw traces, machine, calibration score, software versions and host/package versions |
| NFR-REP2 | Noise floor (A/A MDE at 95%) is reported per host and profile; campaign days whose A/A exceeds 2× the median MDE are re-run |
| NFR-REP3 | Measurement machine: no other workloads, fixed power/CPU-governor settings, same Chromium binary for the whole dataset release |
| NFR-REP4 | All random choices (run order, CV folds, bootstrap) are seeded and logged |

### 5.3 Security & privacy
| ID | Requirement |
|---|---|
| NFR-S1 | Untrusted package code runs only in containers with no secrets, no host mounts except a scratch dir, dropped capabilities, CPU/mem/pid/time limits, egress restricted to the npm registry (or none during measurement) |
| NFR-S2 | Uploaded projects are deleted after 24 h unless the user opts in to contribute measurements |
| NFR-S3 | Quick mode and CLI never upload source code; CLI sends only the feature vector |
| NFR-S4 | Input validation with Zod (API) and Pydantic (ML); archive extraction guards against zip-slip and size bombs |
| NFR-S5 | Rate limiting on public endpoints; verification limited per user/day (it is expensive) |

### 5.4 Reliability & availability
NFR-R1 Workers are idempotent and retry transient failures (max 3, exponential backoff). NFR-R2 A failed candidate does not fail the whole analysis. NFR-R3 Health checks for all services; queue depth visible in an admin page.

### 5.5 Usability
NFR-U1 First-time user completes a Quick-mode analysis in ≤ 2 minutes without docs (tested with 5 users). NFR-U2 Every number shows its provenance: *exact*, *modeled*, *predicted*, or *measured*. NFR-U3 Plain-language explanations avoid jargon or link to a glossary.

### 5.5b Responsiveness & accessibility (course-mandated)
| ID | Requirement |
|---|---|
| NFR-U4 | Every page is usable at **360 px (mobile), 768 px (tablet), 1366 px (laptop) and 1920 px (desktop)** with no horizontal scrolling and no overlapping content |
| NFR-U5 | Touch targets ≥ 44×44 px on mobile breakpoints; forms usable one-handed |
| NFR-U6 | Data tables and the comparison forest plot degrade to a readable stacked layout below 768 px |
| NFR-U7 | WCAG 2.1 AA contrast, full keyboard navigation, visible focus, and a text equivalent for every chart (extends UI-7) |

### 5.5c Deployment topology (added 2026-10-02 — see doc 06 §7)
| ID | Requirement |
|---|---|
| NFR-D1 | The web app and API are deployed on a free-tier host and are reachable without any local process running |
| NFR-D2 | Byte-level analysis of an unseen package completes without a developer's machine (CI worker); it performs **no timing measurement**, so a shared runner does not violate NFR-REP3 |
| NFR-D3 | Timing measurements run **only** on a registered quiet machine; the UI states which tier produced every number |
| NFR-D4 | Secrets are provided as environment variables and never committed; the repository contains `.env.example` only |

### 5.6 Maintainability & portability
NFR-M1 TypeScript `strict`, ESLint + Prettier; Python with ruff + mypy (lenient); ≥ 70% unit-test coverage on analyzer, trace parser and statistics modules. NFR-M2 `docker compose up` starts the whole stack. NFR-M3 Feature schema changes bump `schemaVersion` and invalidate cached features.

## 6. Data requirements

- D-1 Entities: packages, import_specs, host_apps, profiles, machines, builds, sessions, runs, labels, features, models, projects, analyses, predictions (ERD in doc 06 §6).
- D-2 Raw traces: gzip-compressed JSON, retained for dataset cells; deleted after 7 days for user verifications unless opted in.
- D-3 Dataset release: Parquet + data dictionary + README + licence (CC BY 4.0 for measurements; no redistribution of package code), Zenodo DOI.

## 7. Use cases

**UC-01 Analyze one candidate (Quick mode)**
1. Dev pastes `package.json` + lockfile. 2. Enters `date-fns`, import `import { format } from 'date-fns'`. 3. Selects *mid-tier mobile*, budget 50 ms. 4. System resolves, builds isolated + estimates context, extracts features, predicts. 5. Results card shows Δbytes (estimated), ΔScript 12 ms [8, 18], verdict *within*, reasons, advice (native `Intl`).
*Alt:* package fails to build for browser → card shows "not browser-compatible", no prediction.

**UC-02 Compare alternatives (Full mode)** — dev uploads repo, lists `moment`, `dayjs`, `date-fns`, `luxon` with typical imports → ranked forest plot; `dayjs` vs `date-fns` marked "no clear difference"; `moment` flagged high risk.

**UC-03 Verify** — card shows *uncertain* (interval straddles budget) → dev clicks *Verify* → progress via SSE → measured 41 ms [36, 47] vs predicted 33 ms [19, 55] → verdict updated to *within* (measured).

**UC-04 CLI in CI** — PR adds `chart.js`; workflow runs `deplens check chart.js --budget 50 --json`; exit code 1 when over budget; JSON attached as artifact.

**UC-05 Run a measurement campaign (researcher)** — select corpus slice + hosts + profile → runner schedules cells → A/A checks → labels stored → daily noise report.

**UC-06 Train & evaluate (researcher)** — `make dataset && make train && make eval` → model card + paper tables; registry updated; ML service reloads.

## 8. Traceability (requirements → features → research questions)

| RQ | Features (doc 04) | Key FRs |
|---|---|---|
| RQ1 measurement & context | F7 | FR-30–35, FR-12, FR-13, FR-52 |
| RQ2 size proxies | F2 | FR-11, FR-13, FR-53 |
| RQ3 prediction | F1, F6 | FR-20, FR-21, FR-25, FR-54 |
| RQ4 decisions & savings | F3, F5, F7 | FR-24, FR-26, FR-30 |
| RQ5 explanation | F4 | FR-23 |

## 9. Acceptance test plan (summary)
- **Unit:** lockfile parsers, injector, Δbytes, feature extractors, trace parser (golden traces), statistics (HL estimator, bootstrap, conformal), risk rules.
- **Contract:** TS ↔ Python feature schema; OpenAPI conformance.
- **Integration:** end-to-end analysis on 3 fixture projects; verification on 1 fixture; campaign resume test.
- **Measurement validation:** A/A null test (Δ CI covers 0 in ≥ 95% of A/A sessions); **injected-cost test** — synthetic packages doing K units of fixed CPU work at import (`@deplens/work-K`) must yield ΔScript linear in K (R² ≥ 0.97, intercept within the A/A noise floor) and a 4×/1× slope ratio ≈ 4 (doc 07 §8). This is the single most important test of the harness.
- **Usability:** 5-user hallway test for NFR-U1.
