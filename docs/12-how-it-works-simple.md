# 12 — How DepLens Works, in Plain English

This document explains the whole system without jargon, as **inputs and outputs** with real examples.
Every module is written as **Input → Process → Output**, which is also the format the project
documentation needs for its Methodology chapter.

Numbers in this document that are marked *measured* were produced by our own harness on 1 Oct 2026
(see `research-log.md`). Nothing here is invented for illustration.

---

## 1. The problem, told as a story

Riya is building a React dashboard. She needs to format dates, so she opens npm and finds four options:
`moment`, `dayjs`, `date-fns`, `luxon`. She wants the one that will not make her app slow on a cheap
Android phone.

What she can find out today:

| Question she asks | Can she answer it today? |
|---|---|
| How big is the package? | ✅ Bundlephobia tells her the size |
| How big is it **after tree-shaking my exact import**? | ✅ bundlejs tells her, roughly |
| How much **CPU time** will it add when my app loads? | ❌ **Nobody tells her** |
| Does it matter that my app **already ships** some of its dependencies? | ❌ No tool knows about her app |
| Which of the four is cheapest **for my app**? | ❌ She would have to install all four and benchmark |

So she picks by size, or by GitHub stars, and hopes.

### Why size is the wrong answer

We measured this directly. Two packages, **identical size** (246 KB of minified JavaScript):

| What the code does | Extra main-thread time | *measured* |
|---|---|---|
| 246 KB of functions that are **never called** | **≈ 0 ms** | ✅ |
| The **same** 246 KB, with every function called once at import | **32.4 ms** | ✅ |

Same bytes. Thirty-two milliseconds apart. Size cannot see the difference, because the browser's
JavaScript engine only fully compiles code it actually runs.

And the cost is not a property of the package either — it depends on the app:

| What Riya adds | Where she adds it | Extra bytes | Extra CPU time | *measured* |
|---|---|---|---|---|
| `import _ from 'lodash'` | a plain React app | **+73,468 B** | **+37.4 ms** | ✅ |
| `import { format } from 'date-fns'` | an app that **already uses date-fns** | **+204 B** | **+1.6 ms** | ✅ |

The second one is almost free — not because date-fns is cheap, but because *that app already paid for
it*. This is the idea the whole project is built on, and the thing no existing tool does.

---

## 2. What you give DepLens, and what you get back

### 2.1 What you give it (inputs)

| Input | Required? | Example | Why it is needed |
|---|---|---|---|
| **Your app** | yes | paste your `package.json` + `package-lock.json`, *or* give a Git URL | To know what your app already ships |
| **Candidate package** | yes | `date-fns`, optionally `date-fns@4.1.0` | The thing you are considering |
| **The exact import line** | recommended | `import { format } from 'date-fns'` | `{ format }` and `import * as everything` cost wildly different amounts |
| **Device profile** | yes (default mobile) | `mid-tier-mobile` | A phone is ~4× slower than your laptop |
| **Budget** | optional | `50 ms`, `30 KB` | Turns numbers into a yes/no answer |
| **Placement** | optional | `initial` (default) or `lazy` | "What if I load it only when needed?" |

### 2.2 What you get back (outputs)

Every number carries a **provenance badge** so you always know how much to trust it:

| Badge | Meaning | Example output |
|---|---|---|
| `exact` | Computed from a real build. Not a guess. | `+19,848 bytes minified, +5,062 bytes brotli` |
| `modeled` | Calculated with a formula from exact numbers. | `+25 ms download on slow 4G` |
| `predicted` | A machine-learning estimate, **always with a range**. | `+11.8 ms (could be 7.9 to 17.5)` |
| `measured` | A real browser ran it. The most trustworthy. | `+37.4 ms (95% confident: 27.0 to 50.3)` |

The full report for one candidate:

| Output | What it tells you | Badge |
|---|---|---|
| **Δ bytes** | Extra JavaScript your users download (minified / gzip / brotli) | `exact` |
| **New packages** | Packages your app does not have yet | `exact` |
| **Shared packages** | Packages your app **already ships**, so you do not pay twice | `exact` |
| **Δ network time** | Extra download time on that profile's connection | `modeled` |
| **Δ script time** ⭐ | **The headline number**: extra main-thread time to compile + run the new code | `predicted` or `measured` |
| ↳ broken into compile / evaluate / garbage-collection | Where the time actually goes | same |
| **Δ blocking time (TBT)** | Extra time the page cannot respond to taps | `predicted` or `measured` |
| **Δ memory** | Extra JavaScript heap | `measured` |
| **Verdict** | `within budget` / `over budget` / `uncertain — verify` | derived |
| **Why** | Top 3–5 reasons in plain language | derived |
| **Advice** | Cheaper import form, lighter alternative, or a built-in browser API | derived |

---

## 3. The modules: Input → Process → Output

This is the actual pipeline. Seven modules, each with a real example.

### Module 1 — Project intake

- **Input:** Riya's `package.json` + `package-lock.json`
- **Process:** Parse the lockfile into the exact list of packages and versions her app installs; detect the framework from the dependency list.
- **Output:**
  ```
  framework: react
  already ships: react@19.1.0, react-dom@19.1.0, react-router-dom@7.x,
                 zustand@5.x, date-fns@4.1.0, @mui/material@7.x  (248 packages total)
  ```

### Module 2 — Build twice (the trick that makes everything work)

- **Input:** Riya's app + `import { format } from 'date-fns'`
- **Process:** Make two copies of her app. Copy A is untouched. Copy B has **exactly one change** — the import, plus a line that stops the bundler from deleting it as unused. Install dependencies for both (never running install scripts — candidate packages are untrusted code). Build both with Vite.
- **Output:** two folders of real, production JavaScript that differ **only** by that one import.

Why two builds? Because the only honest way to know what a change costs is to measure the app with and
without it. We are not guessing at the package in isolation; we are measuring *her app*, twice.

### Module 3 — Byte diff

- **Input:** the two builds
- **Process:** Compress every output file with fixed settings (gzip-9, brotli-11), add up the files the browser loads on first paint, subtract. Attribute bytes to the package each one came from.
- **Output** (*exact*, this is real output from our tool):
  ```
  Δ minified : +204 bytes
  Δ brotli   : +276 bytes
  new packages   : (none)
  shared packages: date-fns          ← her app already had it
  ```
  Compare the same step for lodash on a plain React app:
  ```
  Δ minified : +73,468 bytes
  Δ brotli   : +23,902 bytes
  new packages   : lodash
  shared packages: (none)
  ```

### Module 4 — Read the added code

- **Input:** only the code that is **new** in build B
- **Process:** Parse it and count the things that make JavaScript expensive at load time: how many functions run immediately at import, how big the data literals are, whether it touches the DOM, whether it ships polyfills, how deep the dependency chain is.
- **Output:** a row of ~40 numbers (the "feature vector"), e.g.
  ```
  added_min_bytes: 73468   top_level_calls: 1    eager_functions: 312
  largest_literal: 4096    touches_dom: false    new_packages: 1
  host_baseline_bytes: 222183   framework: react    profile: mid-tier-mobile
  ```

### Module 5 — Predict

- **Input:** that row of numbers
- **Process:** A gradient-boosted tree model (trained on thousands of real measurements we collect) estimates the extra script time, and a statistical method called conformal prediction turns it into an honest range.
- **Output:**
  ```
  Δ script time: 11.8 ms   (range 7.9 – 17.5 ms)   [predicted]
  ```
  **Important:** the range is not decoration. If it straddles your budget, the tool says
  *"I do not know — go measure"* instead of pretending.

### Module 6 — Explain and advise

- **Input:** the prediction + the model's internal contributions
- **Process:** Convert each contributing factor into a sentence; check a list of known cheaper options.
- **Output:**
  ```
  Why:
    + Adds 17 KB of minified code to your initial bundle      (+6.1 ms)
    − Only 2% of the package survives tree-shaking            (−4.0 ms)
    − Almost nothing runs at import time (0 eager calls)      (−1.2 ms)
  Advice:
    • Intl.DateTimeFormat is built into every browser and costs 0 bytes
    • You already ship date-fns — this import is nearly free
  ```

### Module 7 — Verify (the real measurement)

- **Input:** the two builds from Module 2
- **Process:** Serve both from a local server. Open build A in headless Chrome with the CPU slowed down to phone speed, record a performance trace, wait for the app to finish rendering, close it. Open build B the same way. Repeat **10 times, alternating the order randomly**, each time in a brand-new browser profile so nothing is cached. Then compute the difference with a robust statistical estimator and a confidence interval.
- **Output** (*measured*, real output from our tool):
  ```
  Δ script time : 37.4 ms   95% confident: 27.0 – 50.3 ms
      compile   : 28.5 ms     ← most of the cost is just compiling the code
      evaluate  :  6.7 ms
      gc        :  2.5 ms
  Δ blocking    : 11.1 ms
  Δ memory      : +0.76 MB
  10 pairs, 0 failed runs, 40 seconds
  ```

**Why 10 alternating pairs and not one run?** Because computers are noisy. A single run of the *same*
build twice can differ by several milliseconds. Running A and B interleaved and comparing pairs cancels
out slow drift (your laptop heating up, a background update). We also regularly run "A vs A" — the same
build against itself — and check the tool reports **zero**. On a quiet machine ours reports
0.1 ms [−0.1, 0.3] — i.e. it can see differences smaller than a millisecond. On a busy machine the same
test reports −1.4 ms [−4.0, 1.3], which is why the tool refuses to measure when the machine is busy.

---

## 4. Worked example, start to finish

**Riya's question:** *"Which date library should I use in my React dashboard? Budget: 50 ms on a mid-range phone."*

**Step 1 — she signs in and creates a project.**
```
Input : package.json + package-lock.json  (pasted)
Output: project #41 — framework React, 248 packages detected
```

**Step 2 — she adds four candidates.**
```
moment      import moment from 'moment'
dayjs       import dayjs from 'dayjs'
date-fns    import { format } from 'date-fns'
luxon       import { DateTime } from 'luxon'
profile: mid-tier-mobile     budget: 50 ms script
```

**Step 3 — she gets the comparison** (shape of the real output; the ms values below come from our
Phase-0 measurements on a different host, so treat them as the format, not final numbers):

| Rank | Candidate | Δ brotli | Δ script time | Verdict |
|---|---|---|---|---|
| 1 | `date-fns { format }` | +5.1 KB | 1.2 ms (−4.2 – 6.1) | ✅ within budget |
| 2 | `dayjs` | +3.0 KB | 4.5 ms (−0.8 – 12.1) | ✅ within budget |
| 3 | `luxon { DateTime }` | +19.2 KB | −4.3 ms (−8.5 – 1.1) | ⚠️ within noise — no real difference |
| 4 | `moment` | +18.1 KB | 22.6 ms (17.0 – 30.5) | ✅ within, but 4× the cost of date-fns |

Plus the markers that make this honest:
- `dayjs` vs `date-fns`: **"no clear difference"** — their ranges overlap, so picking either is fine.
- `luxon`: its range crosses zero, meaning the tool cannot distinguish its cost from nothing on this app.

**Step 4 — she clicks Verify on the one she cares about.** A real browser measurement runs and replaces
the prediction with a `measured` number and a tighter range. Her verdict updates. The measurement is
(with her permission) added to the public dataset, which makes the model better for everyone.

**Step 5 — she acts.** She picks `date-fns`, and the advice panel points out she can get the same result
with `Intl.DateTimeFormat` and zero bytes if she only needs one format.

---

## 5. What runs where, and why it has to be split

The measurement in Module 7 needs three things no free hosting provides: a real Chrome browser, the
ability to install arbitrary packages, and — most importantly — a **quiet machine** (we proved the
numbers are junk on a busy one). So the system runs in three tiers.

| Tier | Where it runs | Cost | What works there | Available when |
|---|---|---|---|---|
| **1. The website** | Vercel (free) + Neon Postgres (free) | ₹0 | Sign-up, login, projects, browsing already-measured packages, comparisons, charts, model card, dataset download | **Always** |
| **2. Byte-analysis worker** | GitHub Actions (free, unlimited on a public repo) | ₹0 | A package nobody has analysed yet: install it, build twice, report **exact Δbytes + a prediction**. Takes 1–2 minutes. | **Always** |
| **3. Measurement worker** | Your own quiet computer, started by you | ₹0 | **Verify** — the real browser measurement, and all dataset collection | When you run it |

Two things make this the right design rather than a compromise:

1. **Tier 2 is allowed to run on shared CI, because it does no timing.** Counting bytes is deterministic
   — the same build always produces the same number, whether the runner is busy or not. Our own project
   rule bans CI runners only for *timing* measurements, and those live in Tier 3.
2. **It matches how the tool is meant to be used.** The website answers instantly from what is already
   known; you only spend a real measurement on the one case where the prediction is too uncertain to
   decide. That "predict, then verify only when needed" workflow is one of the project's research
   contributions, so the deployment shape is the product idea, not a hosting limitation.

For a live demo this is actually ideal: the site is up 24/7 for anyone to click, and during the
presentation you start the local worker and hit **Verify** to show a real browser measurement happening.

---

## 6. What DepLens deliberately does **not** tell you

Being clear about this is part of the project's honesty, and it goes in the documentation.

| We do not answer | Why |
|---|---|
| "How slow is this chart library when I render 10,000 points?" | That depends on *your* data and *your* code, not on the import. Cannot be predicted from static information. |
| "How will this affect responsiveness after load (INP)?" | That needs real users tapping real buttons. A scripted click would measure our script, not your users. |
| "Exactly how many milliseconds on a Samsung A14?" | We emulate a slow CPU and calibrate it; we do not own a device lab. We say "mid-tier mobile", and we say what that means. |
| "Is this package secure / well-maintained?" | Other tools (npm audit, Snyk, Socket) already do this well. |
| Firefox and Safari | We measure Chromium only. Stated as a limitation. |

And one thing worth saying out loud: **for any single package, a real measurement is more trustworthy
than our prediction.** The value of the prediction is that it is instant, works before you install
anything, can rank five alternatives at once, and — crucially — tells you when it is not confident
enough and you should measure instead.

---

## 7. Fifteen-second summary

> Bundlephobia tells you how **big** a package is.
> DepLens tells you how much **slower your app** will start if you add **this exact import**, on a
> **phone** — with an honest uncertainty range, the reasons why, cheaper alternatives, and a button
> that proves the number with a real browser when it matters.
