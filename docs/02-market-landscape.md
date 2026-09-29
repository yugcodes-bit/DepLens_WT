# 02 — Market & Tool Landscape (what exists in practice)

Researched September 2026. Tools change fast — re-check each before the paper's related-work section is frozen.

## 1. The tool categories

We group existing tools by **when** they act and **what** they measure. The gap is visible from that grid alone.

| | Measures **bytes** | Measures **CPU/runtime** |
|---|---|---|
| **Before integration** (pre-install) | Bundlephobia, Packagephobia, npmx, bundlejs, Import Cost, pkgsense | **— nobody —** (third-party-web does this only for CDN third-party *origins*, not bundled npm packages) |
| **After integration** (build / PR / deploy) | webpack-bundle-analyzer, Statoscope, RelativeCI / bundle-stats, Codecov Bundle Analysis, size-limit (file preset) | size-limit `/time` (estimo), Lighthouse / Lighthouse CI, commercial RUM & synthetic monitoring |

DepLens targets the empty cell, and also improves the "bytes before integration" cell by making it context-aware (dedup with what the app already ships).

## 2. Tool-by-tool

### 2.1 Bundlephobia
- **Does:** reports minified and gzipped size of a package, estimated download time, dependency composition, and whether the package can be tree-shaken. Widely used; many tools (e.g., VS Code extension *pkgsense*) call its API.
- **Limits:** it sizes the **whole package**, not what you import — so developers may reject a package on a "hasty flat size check" (Sordyl, *Measure npm package sizes effectively*). No CPU time. No knowledge of your app.
- **Lesson for us:** a Bundlephobia-style whole-package size is our weakest baseline (B1). We re-implement it ourselves with esbuild instead of scraping the service at scale.

### 2.2 npmx.dev
- **Does:** a modern npm registry browser: install size incl. transitive deps, ESM/CJS badges, outdated-dependency and vulnerability warnings (OSV), "license, replacement, install script, and size-change warnings", and **package comparison** by downloads, size, dependencies, types, security, repository health.
- **Limits:** install size ≠ shipped size ≠ runtime cost. Comparison is context-free.
- **Lesson:** "compare alternatives" is a feature developers clearly want; npmx has it for metadata, not for runtime cost in your app. We don't re-build security/licence signals — npmx already does.

### 2.3 bundlejs.com
- **Does:** tree-shakes, bundles, minifies and compresses (gzip/brotli) the exports you specify, using esbuild-wasm in the browser; "aims to generate more accurate bundle size estimates by following the same approach that bundlers use."
- **Limits:** bytes only; isolated from your app.
- **Lesson:** import-aware size is our second baseline (B2). We borrow the idea of an explicit import spec.

### 2.4 Import Cost (VS Code) and similar editor plugins
- **Does:** inline size of each import line.
- **Limits:** bytes, context-free.
- **Lesson:** the right UX moment is *while writing the import*. A VS Code extension is a natural future front-end for DepLens (out of scope for this semester).

### 2.5 size-limit + `@size-limit/time` (uses estimo)
- **Does:** CI guard that fails a PR when size or **time** limits are exceeded. The time plugin "runs headless Chrome (or desktop Chrome if it's available) to track the time a browser takes to compile and execute your JS" and "compares the current machine performance with that of a low-priced Android devices to calculate the CPU throttling rate." Output looks like: *Loading time 602 ms on slow 3G · Running time 214 ms on Snapdragon 410*.
- **Limits:** acts after you integrate; measures your whole bundle, not the dependency's marginal share; the README itself warns that the measurements "depend on available resources and might be unstable", and users in issue #110 report different results on every run for the same file and flag false positives in CI.
- **Lesson:** (1) runtime measurement is already accepted by practitioners as more meaningful than bytes for large libraries ("the execution time is a more accurate and understandable metric than the size in bytes" — size-limit README); (2) instability is a known pain point → our paired protocol + intervals is a genuine improvement; (3) this is our "measure instead of predict" baseline (B4).

### 2.6 estimo
- **Does:** measures parse/compile/execution time of a JS file or page via Puppeteer + Chrome trace (processed with Tracium), with CPU throttling, network emulation, device emulation, `runs` (median of N), and a **diff mode** comparing a baseline file to other versions. Reports `scriptParseCompile`, `scriptEvaluation`, `garbageCollection`, `styleLayout`, etc., and documents exactly which trace events feed each bucket.
- **Limits:** you must already have the files to compare; no prediction; median-of-N without intervals or pairing.
- **Lesson:** estimo's event taxonomy is a good, citable starting point for our trace parser (doc 07 §4.4).

### 2.7 Lighthouse / Lighthouse CI
- **Does:** whole-page lab audits including a *bootup-time* audit (script time per URL), budgets, and CI assertions.
- **Limits:** post-hoc and page-level. Its docs are explicit that **CPU throttling is relative to the host machine** ("4x on a fast laptop and 4x on a CI runner stand for different phones"), and it records a `benchmarkIndex` to help calibrate; they also document run-to-run variability.
- **Lesson:** we must calibrate our CPU slowdown against a reference, record the host's benchmark, and quantify variability ourselves (doc 07 §3).

### 2.8 Post-build bundle analysis (webpack-bundle-analyzer, Statoscope, RelativeCI / bundle-stats, Codecov Bundle Analysis)
- **Does:** treemaps; build-to-build comparison; "duplicate packages, new packages"; PR comments ("Changes will increase total bundle size by X — within the configured threshold ✅").
- **Limits:** bytes, after the change is built.
- **Lesson:** developers accept PR-comment workflows for bundle regressions. A DepLens GitHub Action that comments *predicted runtime* cost when `package.json` changes fits an existing habit (stretch feature).

### 2.9 third-party-web (Patrick Hulce, HTTP Archive data)
- **Does:** aggregates Lighthouse *bootup-time* across millions of mobile page loads to rank third-party **entities** (ads, analytics, embeds) by average main-thread execution time.
- **Limits:** CDN-hosted third-party origins, not npm packages bundled into your code; averages across the web, not your app.
- **Lesson:** strong precedent that a **per-entity cost database** is useful and citable. Our dataset is the analogous thing for bundled npm dependencies, measured under control rather than in the wild.

### 2.10 e18e (Ecosystem Performance) — module-replacements, ESLint plugin, CLI
- **Does:** community-curated manifests of modules replaceable by native APIs, "micro-utilities", and "preferred" lighter alternatives; an ESLint plugin and CLI codemods; their 2026 plan integrates Baseline / web-features to make target-aware suggestions.
- **Limits:** curated opinions; no measured cost numbers; not app-aware.
- **Lesson:** (1) this is the right *source of alternative groups* for our compare feature and for RQ4's ranking evaluation; (2) we add what they lack — measured/predicted cost of each alternative in the user's app. Complementary, not competing. Consider contributing data back.

### 2.11 Commercial monitoring (DebugBear, SpeedCurve, Calibre, RUM products)
- **Does:** continuous lab and field monitoring of deployed pages.
- **Limits:** post-deploy, page-level. Out of reach for a pre-install decision.

## 3. Feature matrix

| Capability | Bundle-phobia | npmx | bundlejs | Import Cost | size-limit/time | estimo | LH / LHCI | RelativeCI / Codecov | e18e | **DepLens** |
|---|---|---|---|---|---|---|---|---|---|---|
| Pre-integration | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ files | ❌ | ❌ | ✅ | ✅ |
| Import-aware (tree-shaking) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| App-aware dedup | ❌ | ❌ | ❌ | ❌ | implicit | ❌ | implicit | ✅ post-build | ❌ | ✅ pre-install |
| Runtime (CPU) cost | ❌ | ❌ | ❌ | ❌ | ✅ measured | ✅ measured | ✅ page | ❌ | ❌ | ✅ predicted + measured |
| Cost breakdown | ❌ | ❌ | ❌ | ❌ | load/run | ✅ parse/eval/GC | per audit | ❌ | ❌ | ✅ |
| Uncertainty / noise | ❌ | ❌ | ❌ | ❌ | ❌ | median | ❌ | ❌ | ❌ | ✅ |
| Alternatives | ⚠️ "similar" | ✅ compare | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ curated | ✅ ranked by cost in your app |
| Explains why | composition | badges | ❌ | ❌ | ❌ | buckets | audits | module diffs | rule text | ✅ SHAP + advisors |
| CI / PR integration | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ ESLint | stretch |

⚠️ = partial.

## 4. The gap in one paragraph (use this in the paper intro)

Pre-install tools report *bytes* of a package in isolation; post-integration tools measure *runtime* of the whole bundle after the developer has already committed. No tool estimates the **runtime cost a specific app will pay for a specific import of a candidate package before it is integrated**, none reports **uncertainty** despite well-documented measurement instability, and none **ranks alternatives by cost in the developer's own app**. DepLens fills this gap and publishes the measured dataset that such estimates require.

## 5. What we deliberately do NOT compete on

- Security/vulnerability, licence, maintenance health → npmx, Snyk, Socket, OSV.
- Treemaps and module-level bundle inspection → existing analyzers.
- Page-level audits → Lighthouse.
- Curating which packages are "bloated" → e18e (we consume their data).

## Sources

- [Bundlephobia limitations — Sordyl, "Measure npm package sizes effectively"](https://sordyl.dev/blog/measure-package-sizes-effectively/)
- [npmx.dev repository](https://github.com/npmx-dev/npmx.dev) · [OpenReplay on npmx](https://blog.openreplay.com/browse-npm-packages-npmx/)
- [bundlejs documentation](https://blog.okikio.dev/documenting-an-online-bundler-bundlejs)
- [size-limit](https://github.com/ai/size-limit) · [@size-limit/time](https://npmjs.com/package/@size-limit/time) · [size-limit issue #110](https://github.com/ai/size-limit/issues/110)
- [estimo](https://github.com/mbalabash/estimo)
- [Lighthouse throttling docs](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md) · [Lighthouse variability docs](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md)
- [RelativeCI bundle-stats](https://github.com/relative-ci/bundle-stats) · [Codecov bundler plugins (PR comment examples)](https://github.com/codecov/codecov-javascript-bundler-plugins/pull/330)
- [third-party-web](https://github.com/patrickhulce/third-party-web)
- [e18e replacements](https://e18e.dev/docs/replacements/) · [module-replacements](https://github.com/e18e/module-replacements) · [e18e: The Year Ahead (2026)](https://e18e.dev/blog/the-year-ahead-2026.html)
- [pkgsense VS Code extension](https://marketplace.visualstudio.com/items?itemName=PabloViniegra.pkgsense)
- [Nolan Lawson — JavaScript performance beyond bundle size](https://nolanlawson.com/2021/02/23/javascript-performance-beyond-bundle-size/)
