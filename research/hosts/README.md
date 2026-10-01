# Host apps

Each directory is one **host app** `H` — the "existing app" a candidate dependency is added to
(doc 01 §2). A host is a measurement instrument, so it is held to a contract, not just expected to run.

## The contract (doc 07 §5, checked by `pnpm harness hosts`)

1. **`host.json`** declares the host: `name`, `framework`, `entry` (the module carrying the injection
   marker), `html`, optional `bundler` / `repoUrl` / `commit` / `notes`.
2. **Injection marker at the top level of the entry module.** The harness replaces the block between
   the markers; the baseline keeps the empty sink, the treatment gets the import plus a sink that keeps
   the bindings alive:
   ```js
   /* @deplens-inject */
   globalThis.__DL_SINK__ = [];
   /* @deplens-end */
   ```
   It must be at top level — a static `import` inside a function body is a syntax error — and it is
   placed first, so the injected module evaluates before the host's own modules.
3. **`performance.mark('app-ready')` after the first render.** The session waits for this mark; without
   it every run times out.
4. **Deterministic render.** No `Math.random()`, no reading the clock (`Date.now()`, `new Date()` with no
   argument), no network. Mock data is derived from indices; `react-heavy` dates come from a fixed epoch.
5. **Builds deterministically.** Three independent builds must produce byte-identical output
   (`pnpm harness hosts --determinism`). Non-determinism would show up as fake Δbytes.
6. **Own `vite.config.js` and committed `package-lock.json`.** The host's toolchain version is part of
   the experimental unit, and the lockfile pins the baseline the treatment is compared against.

## The hosts

| Host | Framework | Baseline initial JS (min / brotli) | Why it is in the set |
|---|---|---|---|
| `empty` | none | 84 B / 88 B | Isolated cost `C_iso` (doc 07 §9) — the context-free comparison |
| `vanilla` | vanilla | 491 B / 283 B | Smallest real render; context ≈ empty page |
| `solid` | Solid | 8.6 KB / 3.3 KB | Compiled framework, tiny runtime |
| `preact` | Preact | 11 KB / 4.4 KB | React-compatible API, small runtime |
| `svelte` | Svelte 5 | 31 KB / 11 KB | Compiled framework |
| `vue` | Vue 3 | 63 KB / 23 KB | Runtime + reactivity |
| `react` | React 19 | 222 KB / 60 KB | The most common context by far |
| `react-heavy` | React 19 | 411 KB / 114 KB | Router + state lib + UI kit + date lib: exercises shared-dependency dedup and TBT task merging |

Still to add (doc 09 P1): two realistic open-source hosts (Conduit-style), pinned by commit SHA.

## Adding a host

```bash
mkdir -p research/hosts/<name>/src           # host.json, package.json, vite.config.js, index.html, src/
cd research/hosts/<name> && npm install --ignore-scripts   # commit the lockfile it produces
cd ../../.. && pnpm harness hosts --host <name> --determinism
```

Framework-specific candidates only run on matching hosts; the compatibility matrix is sparse by
design and is recorded with the corpus (doc 07 §5).
