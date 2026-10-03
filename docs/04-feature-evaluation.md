# 04 — Feature Evaluation (what to build, what to refuse)

Goal: a **small set of features a frontend developer would actually use**, each justified by user value *and* by the research. Everything else is cut on purpose. Tool bloat would be ironic for a tool about dependency bloat.

## 1. Evaluation criteria (score 1–5)

| Code | Criterion | Question asked |
|---|---|---|
| **U** | User value | Would a developer choosing a dependency use this at the moment of decision? Does it change the decision? |
| **R** | Research value | Does it produce evidence for an RQ, or is it needed to evaluate one? |
| **N** | Novelty vs tools | Is it missing from Bundlephobia/npmx/bundlejs/size-limit/Lighthouse/e18e? |
| **C** | Cost (inverted: 5 = cheap) | Engineering effort for a 3–4 person student team within the semester |
| **K** | Risk (inverted: 5 = safe) | Chance it fails or produces misleading output |

**Priority score** = 2·U + 2·R + N + C + K (max 35). Then MoSCoW with judgment, not blindly by score.

## 2. Candidate features scored

| # | Feature | U | R | N | C | K | Score | Decision |
|---|---|---|---|---|---|---|---|---|
| F1 | **In-context ΔScript prediction with interval** for one candidate + import | 5 | 5 | 5 | 3 | 3 | **31** | **MUST** — the core |
| F2 | **Exact in-context Δbytes** (min/gz/br) incl. new vs already-shipped packages | 5 | 4 | 4 | 4 | 5 | **31** | **MUST** — deterministic, builds trust, needed as feature & baseline |
| F3 | **Budget verdict + risk level** from the interval | 5 | 3 | 4 | 5 | 4 | **29** | **MUST** — turns numbers into a decision |
| F4 | **"Why" explanations** (SHAP → plain language) | 4 | 4 | 4 | 4 | 3 | **27** | **MUST** — RQ5; prevents black-box distrust |
| F5 | **Compare alternatives** (user lists 2–5 candidates) ranked with intervals | 5 | 5 | 5 | 4 | 3 | **32** | **MUST** — RQ4; the most decision-relevant view |
| F6 | **Device profile presets** (desktop / mid-tier / low-end mobile) | 4 | 3 | 2 | 4 | 3 | **23** | **MUST** — cheap once calibration exists; keep to 3 presets |
| F7 | **Verify with real measurement** (paired A/B in Chromium), shows measured vs predicted | 4 | 5 | 4 | 3 | 4 | **29** | **SHOULD** (MUST for the paper) — predict-then-verify, RQ4 savings |
| F8 | **Cost breakdown**: network (modeled) vs compile vs evaluate vs GC | 4 | 3 | 3 | 3 | 3 | **23** | **SHOULD** — show measured breakdown on Verify; predicted breakdown only if the per-component models are accurate |
| F9 | **Import-form advice** (namespace → named; `lodash` → `lodash/debounce` or `lodash-es`; CJS vs ESM build) | 5 | 2 | 4 | 4 | 4 | **26** | **SHOULD** — deterministic (bytes computed exactly per form), highly actionable |
| F10 | **Auto-suggest alternatives** from e18e module-replacements + curated groups, incl. "use native API" | 4 | 3 | 3 | 4 | 3 | **24** | **SHOULD** — reuse e18e data; label curated vs measured clearly |
| F11 | **CLI** (`deplens check <pkg> --import "..."`) running locally, sending only features | 4 | 2 | 3 | 4 | 4 | **23** | **SHOULD** — privacy-preserving, easy demo, basis for CI |
| F12 | **Model card page** (data size, error on unseen packages, known failure modes) | 3 | 4 | 4 | 5 | 5 | **28** | **SHOULD** — cheap; academic honesty visible in the product |
| F13 | **Lazy-load what-if** (`import()` → cost moves from load to first use) | 3 | 3 | 4 | 3 | 3 | **22** | **COULD** — deterministic chunk analysis; prediction for the lazy chunk reuses the same model |
| F14 | **GitHub Action PR comment** when `package.json` gains/bumps a dependency | 4 | 2 | 4 | 3 | 3 | **22** | **COULD** — high practical value, fits existing PR-bot habits; after core is stable |
| F15 | **Version-bump impact** (e.g., `chart.js 4.4 → 4.5`) | 4 | 2 | 4 | 4 | 3 | **23** | **COULD** — same pipeline with two versions; nice demo |
| F16 | **Public cost explorer** (browse the measured dataset) | 2 | 4 | 4 | 4 | 4 | **24** | **COULD** — doubles as the dataset artifact's front-end |
| F17 | Usage-scenario cost (calling the API with inputs) | 4 | 3 | 5 | 1 | 1 | 21 | **WON'T (this semester)** — not statically predictable in general; curated subset only as future work |
| F18 | INP prediction | 4 | 2 | 4 | 1 | 1 | 18 | **WON'T** — no trustworthy lab label |
| F19 | VS Code extension | 4 | 1 | 3 | 2 | 3 | 18 | **WON'T (this semester)** — right UX long-term; CLI + API make it easy later |
| F20 | Vulnerability / licence / maintenance scores | 3 | 1 | 1 | 3 | 4 | 16 | **WON'T** — npmx, Snyk, Socket, OSV already do it |
| F21 | Bundle treemap / module explorer | 2 | 1 | 1 | 3 | 5 | 15 | **WON'T** — webpack-bundle-analyzer, Statoscope exist |
| F22 | LLM chat that "explains" results | 2 | 1 | 1 | 3 | 1 | 11 | **WON'T** — adds hallucination risk; SHAP templates are exact and cheaper |
| F23 | Real-device farm measurements | 3 | 4 | 3 | 1 | 2 | 20 | **WON'T** as a feature — but do a **small real-device validation** (1 Android phone) for the paper if you have one |
| F24 | webpack / Next.js / Angular project support | 4 | 1 | 1 | 1 | 2 | 14 | **WON'T (MVP)** — Vite + Quick mode first; add later |

## 2.1 Platform & security features (course-mandated, added 2026-10-02)

The scoring in §2 is deliberately research-weighted, so a feature that is mandatory for the course
rubric can score low there and still be a MUST. These are mandated by the project guidelines
(sessions, cookies, encryption, authentication, authorization, CAPTCHA, OTP, email verification,
validation, responsiveness). Each one listed below **also** has a product reason, given in the last
column — we are not adding anything purely to tick a box.

| # | Feature | U | R | N | C | K | Score | Decision | Product reason it earns its place |
|---|---|---|---|---|---|---|---|---|---|
| F25 | **Accounts + email/password login** with server-side sessions in `httpOnly` cookies | 3 | 2 | 1 | 4 | 4 | 19 | **MUST (course)** | Saved projects and analysis history; an owner for opt-in dataset contribution |
| F26 | **Email verification + OTP** on sign-up and on sensitive actions | 2 | 1 | 1 | 3 | 3 | 13 | **MUST (course)** | A verified address is what makes per-user verification quotas (NFR-S5) meaningful |
| F27 | **CAPTCHA** on sign-up / login / password reset | 2 | 1 | 1 | 4 | 4 | 14 | **MUST (course)** | Verification runs are expensive machine time; bots must not be able to queue them |
| F28 | **Role-based authorization** — `user` / `researcher` / `admin` | 3 | 3 | 1 | 4 | 4 | 21 | **MUST (course)** | Only researchers may launch campaigns or publish a model; only admins see the queue |
| F29 | **Validation suite** — required, range, compare, email, number, custom (import-spec syntax) | 4 | 2 | 1 | 5 | 5 | 23 | **MUST (course)** | An invalid import spec silently produces a meaningless cell; validation is the first line of FR-34 |
| F30 | **Responsive layouts** — mobile / tablet / laptop / desktop | 4 | 1 | 1 | 4 | 5 | 20 | **MUST (course)** | A tool about mobile performance that is unusable on a phone would be indefensible |
| F31 | **Password reset** via emailed single-use token | 3 | 1 | 1 | 4 | 4 | 17 | **SHOULD (course)** | Expected of any account system; cheap once F26's mailer exists |
| F32 | **Audit log** of security-relevant events (login, logout, failed attempts, role change) | 2 | 2 | 2 | 5 | 5 | 20 | **SHOULD (course)** | Doubles as evidence for the Testing chapter and for the Books-and-Records style requirement |

**Explicitly not doing:** third-party OAuth (Google/GitHub sign-in). It would hide exactly the
mechanisms the course asks us to implement — sessions, cookies, hashing, OTP — behind a provider.
We implement our own so there is something to document and test.

## 3. Final feature set

### MUST (the MVP — demo-able and paper-supporting)
1. **F1 Predict** ΔScript (and ΔTBT) with an 80% interval for a candidate + import in your app.
2. **F2 Exact Δbytes** with new-vs-shared package list.
3. **F3 Verdict & risk** against an optional budget.
4. **F4 Why** — top 3–5 contributing factors in plain language.
5. **F5 Compare** 2–5 alternatives, ranked (forest-plot of intervals), with "difference is within noise" when intervals overlap heavily.
6. **F6 Profiles** — three calibrated presets.
7. **F25–F30 Platform & security** (§2.1) — accounts with session cookies, email verification + OTP,
   CAPTCHA, role-based authorization, the six-validator suite, and responsive layouts.

### SHOULD (second half of the semester)
7. **F7 Verify** — real paired measurement on demand, auto-suggested when uncertain.
8. **F9 Import-form advice** and **F10 alternative suggestions** (e18e + curated).
9. **F11 CLI** and **F12 model card**.
9b. **F31 password reset** and **F32 audit log** (§2.1).
10. **F8 Breakdown** (measured always; predicted only if good enough).

### COULD (only if ahead of schedule)
11. F13 lazy-load what-if · F14 GitHub Action · F15 version bump · F16 cost explorer.

## 4. Why these and not more

- **Everything in MUST answers one question:** *"Should I add this, in this form, to this app — or something else?"* F1/F2 answer "how much", F3 "is it acceptable", F4 "why", F5 "what instead", F6 "for whom".
- **Deterministic before learned.** F2, F9, F13 are exact computations from the build; they are always correct and make the learned parts credible.
- **Every learned number comes with an interval** and a path to measure it (F7). This is the product expression of RQ4 and the honest answer to "why not just measure".
- **We cut features that other tools already do well** (F20–F21) and features that would produce numbers we cannot validate (F17–F18, F22).

## 5. User stories (for the SRS)

| ID | As a… | I want to… | So that… | Features |
|---|---|---|---|---|
| US-1 | frontend dev about to add a date library | see the predicted extra main-thread time for `import { format } from 'date-fns'` in my app on a mid-tier phone | I know if it's acceptable before I write integration code | F1, F2, F6 |
| US-2 | dev choosing between 4 chart libraries | see them ranked by predicted cost in my React app, with uncertainty | I pick the cheapest one that fits, or know the difference is negligible | F5 |
| US-3 | tech lead with a 50 ms script budget | get a clear within/over/uncertain verdict | I can enforce budgets at design time, not after a regression | F3 |
| US-4 | skeptical dev | see why the tool thinks a small package is expensive | I trust (or challenge) the prediction | F4, F12 |
| US-5 | dev whose result is "uncertain" | run a real measurement with one click | I get a trustworthy number for the case that matters | F7 |
| US-6 | dev importing lodash | learn that `lodash-es` named imports cost a fraction of `lodash` | I fix it by changing one line | F9 |
| US-7 | dev who can't upload code | analyze from `package.json` + lockfile or run the CLI locally | my source stays private | Quick mode, F11 |
| US-8 | researcher / reviewer | inspect model accuracy on unseen packages and known failure modes | I can judge the claims | F12, F16 |
