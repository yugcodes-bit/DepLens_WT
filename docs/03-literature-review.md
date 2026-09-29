# 03 — Literature Review & Research Gaps

## 0. How this review was done (write this up as your "search protocol")

- **Sources:** ACM DL, IEEE Xplore, USENIX, arXiv, Springer Link, DBLP, Semantic Scholar; grey literature (V8 blog, Lighthouse docs, tool READMEs) only where it documents engine/tool behaviour.
- **Queries (re-run before submission; record hit counts):**
  - `"JavaScript" AND ("dependency" OR "library" OR "npm") AND ("performance" OR "execution time" OR "bundle size")`
  - `"npm" AND ("bloat" OR "unused dependencies" OR "production dependencies")`
  - `("dead code" OR "debloat*") AND ("JavaScript" OR "web page")`
  - `("page load" OR "mobile web") AND ("JavaScript" OR "computation") AND ("critical path" OR "bottleneck")`
  - `("performance prediction" OR "execution time prediction") AND ("machine learning" OR "neural") AND ("source code" OR "configurable")`
  - `("web performance" OR "Lighthouse") AND ("variability" OR "reproducib*")`
- **Inclusion:** peer-reviewed (or widely cited preprint), 2012–2026, about (a) where browser time goes, (b) JS/dependency bloat, (c) dependency selection, (d) ML performance prediction from code/config, (e) performance measurement methodology.
- **Snowballing:** backward/forward from Muzeel, DepPrune and TEP-GNN reference lists.
- **Result of our search:** we found **no paper that predicts the incremental browser-runtime cost of adding an npm dependency to a specific app before integration**, and no public dataset of measured per-dependency browser cost across host apps. A 2025 systematic review of website-performance prediction (30 studies, 2010–2024) likewise does not cover JS dependency cost and lists the *lack of public datasets* as a gap. **Absence of evidence is not evidence of absence — repeat the searches and check the 2026 proceedings of ICWE, WWW, ICPE, MSR, ICSE, FSE, ASE before claiming "first".**

Verification status: ✅ = details confirmed from the publisher/DBLP/arXiv page during this review; ◻ = well-known reference, confirm BibTeX on DBLP before citing.

---

## 1. Theme A — Where browser time goes: JavaScript computation matters, especially on mobile

**[A1] Wang, Balasubramanian, Krishnamurthy, Wetherall — "Demystifying Page Load Performance with WProf", USENIX NSDI 2013, pp. 473–485. ✅**
- *Problem/method:* in-browser profiler that builds a dependency graph of network, parsing, JS/CSS evaluation and rendering activities; critical-path analysis on 350 pages.
- *Findings:* computation makes up **as much as 35% of the critical path**; synchronous JavaScript evaluation significantly affects page load time because it blocks HTML parsing.
- *Relevance:* foundational evidence that JS computation (not just bytes) is on the critical path. Also the origin of "what-if" reasoning about speeding up activities.
- *Gap vs us:* page-level, not dependency-level; no prediction of a change's cost.

**[A2] Nejati & Balasubramanian — "An In-depth Study of Mobile Browser Performance", WWW 2016, pp. 1305–1315, doi:10.1145/2872427.2883014. ✅**
- *Method:* testbed comparing low-level page-load activities on mobile vs desktop browsers.
- *Finding:* **computation is the main bottleneck on mobile browsers**, whereas networking dominates on desktop.
- *Relevance:* justifies the mobile CPU profile as our default and ΔScript as our primary metric.
- *Gap:* characterisation study; no dependency-level attribution or prediction.

**[A3] Pourghassemi, Amiri Sani, Chandramowlishwaran — "What-If Analysis of Page Load Time in Web Browsers Using Causal Profiling", Proc. ACM Meas. Anal. Comput. Syst. (SIGMETRICS) 3(2), Art. 27, 2019, doi:10.1145/3341617.3326142. ✅**
- *Method:* COZ+, a causal profiler for Chromium, estimates the page-load impact of speeding up each browser computation stage.
- *Finding (example):* optimising JavaScript by 40% is expected to improve Chromium page load by more than 8.5% under typical network conditions.
- *Relevance:* shows the *marginal* effect of JS time on PLT is non-trivial but not 1:1 — consistent with our choice to report ΔScript and ΔTBT separately from page-level metrics.
- *Gap:* browser-internal stages, not application dependencies.

**[A4] V8 team documentation (grey literature)** — *The cost of JavaScript in 2019*; *Blazingly fast parsing, part 2: lazy parsing*; *Explicit Compile Hints* (2025).
- V8 pre-parses functions lazily and eagerly compiles "possibly-invoked function expressions" (PIFEs); over-eager compilation "significantly regresses load time" and costs memory. Script streaming parses async/deferred scripts off the main thread. Explicit compile hints reduced foreground parse+compile by 630 ms on average in 17 of 20 popular pages tested.
- *Relevance:* this is the **physical basis of our AST features** — cost depends on how much code runs/compiles at load (top-level calls, IIFEs/PIFEs, large literals), not only on byte size. Cite as engineering documentation, not as peer-reviewed evidence.

## 2. Theme B — JavaScript bloat and debloating of web pages

**[B1] Chaqfeh, Zaki, Hu, Subramanian — "JSCleaner: De-Cluttering Mobile Webpages Through JavaScript Cleanup", WWW 2020, pp. 763–773, doi:10.1145/3366423.3380157. ✅**
- *Method:* rule-based classification of scripts into non-critical / replaceable / critical; removes non-critical JS, replaces replaceable JS with its HTML outcome.
- *Relevance:* shows large wins from removing JS on low-end mobile. *Gap:* post-hoc page rewriting (a cure), not a pre-install decision aid (prevention).

**[B2] Kupoluyi, Chaqfeh, Varvello, Coke, Hashmi, Subramanian, Zaki — "Muzeel: Assessing the Impact of JavaScript Dead Code Elimination on Mobile Web Performance", ACM IMC 2022, pp. 335–348, doi:10.1145/3517745.3561427. ✅**
- *Method:* black-box dynamic analysis that emulates user interactions after load to find functions that are never executed, then eliminates them.
- *Data/findings:* on 15,000 popular pages, **half of the 300,000 JS files have at least 70% unused functions, accounting for 55% of the files' sizes**; serving 200 "Muzeel-ed" pages to Android phones sped up page loads by **25–30%** while preserving appearance and interactivity.
- *Relevance:* strongest quantitative motivation — much of shipped JS (largely library code) is unused yet costs CPU and bandwidth. Also a methodological model for device-level evaluation.
- *Gap:* operates on deployed pages; does not attribute cost to an npm package or predict it before adoption.

**[B3] Chaqfeh, Coke, Hu, Hashmi, Subramanian, Rahwan, Zaki — "JSAnalyzer: A Web Developer Tool for Simplifying Mobile Web Pages through Non-critical JavaScript Elimination", ACM Trans. Web 16(4), Art. 17, 2022, doi:10.1145/3550358. ✅**
- *Relevance:* precedent for a **developer-facing tool paper** in this space (useful template for our tool section). *Gap:* elimination on existing pages.

**[B4] Chaqfeh, Haseeb, et al. — "To Block or Not to Block: Accelerating Mobile Web Pages On-The-Fly Through JavaScript Classification" (SlimWeb), ACM ICTD 2022, doi:10.1145/3572334.3572397; arXiv:2106.13764. ✅**
- *Method:* **supervised ML** classifies each script as essential/non-essential and blocks the rest on the fly.
- *Findings:* median 90% classification accuracy; ~50% page-load-time reduction vs original pages on 500 pages over 3G/4G; user studies.
- *Relevance:* closest precedent for **ML over JavaScript features for performance decisions**. *Gap:* classifies scripts on pages for blocking; does not regress cost of adopting a dependency.

**[B5] Malavolta, Nirghin, Scoccia, Romano, Lombardi, Scanniello, Lago — "JavaScript Dead Code Identification, Elimination, and Empirical Assessment", IEEE TSE 2023, doi:10.1109/TSE.2023.3267848; arXiv:2308.16729. ✅**
- *Method:* Lacuna, call-graph-based dead-code elimination combining static and dynamic analyses; experiment on 30 mobile web apps on Android measuring energy, performance, network and resource use.
- *Findings:* removing dead code positively impacts loading time and significantly reduces bytes transferred.
- *Relevance:* rigorous **experiment-design template** (controlled device experiments, statistics). *Gap:* post-hoc removal.

## 3. Theme C — Dependency bloat in the npm ecosystem

**[C1] Latendresse, Mujahid, Costa, Shihab — "Not All Dependencies are Equal: An Empirical Study on Production Dependencies in NPM", ASE 2022, doi:10.1145/3551349.3556896; arXiv:2207.14711. ✅**
- *Method:* 100 JS projects; identify which dependencies actually reach production bundles using bundlers with tree-shaking.
- *Findings:* **less than 1% of installed dependencies are released to production**; **59%** of dependencies declared as runtime are not used in production; **28.2%** of dev-dependencies are.
- *Relevance:* validates using the **build output, not package.json declarations**, as the source of truth — exactly our treatment/baseline build design. *Gap:* presence in production, not runtime cost.

**[C2] Weeraddana, Alfadel, McIntosh — "Dependency-Induced Waste in Continuous Integration: An Empirical Study of Unused Dependencies in the npm Ecosystem", Proc. ACM Softw. Eng. 1(FSE), Art. 116, 2024, doi:10.1145/3660823. ✅**
- *Relevance:* unused dependencies waste CI resources; related line on bloated dependencies. *Gap:* CI cost, not end-user browser cost.

**[C3] Liu, Tiwari, Bogdan, Baudry (verify author list) — "Detecting and removing bloated dependencies in CommonJS packages", J. Systems & Software, 2025; arXiv:2405.17939. ✅ (title/venue) ◻ (authors)**
- *Method:* DepPrune, trace-based dynamic analysis of file accesses to find dependencies never accessed at runtime; 91–92 CommonJS packages, 50,661 dependencies; compared with depcheck and coverage-based approaches.
- *Relevance:* shows **static analysis alone misjudges JS due to dynamic patterns** — a caution for our static features and a reason we measure ground truth. Server-side only.

**[C4] Related ecosystem studies (◻, cite as needed):** Jafari et al. 2021 (dependency smells in JS projects, IEEE TSE); Soto-Valero et al. 2021 (bloated dependencies in Maven, EMSE 26(3)); Turcotte et al. 2022 (Stubbifier, debloating server-side JS, EMSE); Koishybayev & Kapravelos 2020 (Mininode, attack-surface reduction for Node.js, RAID). All focus on presence/security/maintenance, not browser runtime cost.

## 4. Theme D — How developers choose dependencies (and alternatives)

**[D1] Mujahid, Abdalkareem, Shihab — "What are the characteristics of highly-selected packages? A case study on the npm ecosystem", J. Systems & Software 198:111588, 2023, doi:10.1016/j.jss.2022.111588. ✅**
- *Method:* survey of 118 JS developers + quantitative analysis of 2,592 packages.
- *Finding:* developers believe highly-selected packages are well-documented, have many GitHub stars and downloads, and no vulnerabilities.
- *Relevance:* performance cost is **not among the signals** developers reported using → it is under-served at decision time; supports the need for a decision aid. (Phrase carefully: "not among the top characteristics reported", don't overclaim.)

**[D2] Mujahid, Costa, Abdalkareem, et al. — "Where to go now? Finding alternatives for declining packages in the npm ecosystem", ASE 2023, pp. 1628–1639, doi:10.1109/ASE56229.2023.00119. ✅**
- *Relevance:* alternative recommendation is an established research problem; we contribute a **cost-aware** ranking of alternatives. Alternative groups can also come from e18e's module-replacements manifests.

## 5. Theme E — Machine-learning performance prediction in software engineering

**[E1] Ha & Zhang — "DeepPerf: Performance Prediction for Configurable Software with Deep Sparse Neural Network", ICSE 2019, pp. 1095–1106, doi:10.1109/ICSE.2019.00113. ✅**
- *Method:* deep feed-forward net + L1 sparsity to predict performance of configurable systems from few sampled configurations; reports mean relative error with 30 repetitions and t-tests.
- *Relevance:* canonical "predict performance instead of measuring every variant" framing — our *configuration* is (host, package, import, profile). Also an evaluation template (repeated runs, CIs, significance tests).
- *Gap:* one system, configuration options as features; not code of third-party dependencies.

**[E2] Siegmund et al. — "Performance-influence models for highly configurable systems", ESEC/FSE 2015, pp. 284–294. ◻** — interpretable performance-influence models; motivates our interpretable (tree + SHAP) choice.

**[E3] Samoaa, Longa, Mohamad, Chehreghani, Leitner — "TEP-GNN: Accurate Execution Time Prediction of Functional Tests Using Graph Neural Networks", PROFES 2022 (Springer LNCS), doi:10.1007/978-3-031-21388-5_32; arXiv:2208.11947. ✅ (venue: verify it is PROFES)**
- *Method:* flow-augmented ASTs + GNN to predict test execution time from **static code only**; 922 test files from 4 Java projects.
- *Findings:* Pearson **0.789**, beating a DL baseline; but "more work is needed for trained models to generalize to **unseen projects**."
- *Relevance:* the closest methodological cousin (static code → absolute execution time). Its generalization warning is exactly why we evaluate with **grouped splits by package and by host app**, and why we don't claim more than the data supports.
- *Gap:* Java unit tests; no web/browser context; no dependency marginal cost.

**[E4] PACE — "A Program Analysis Framework for Continuous Performance Prediction", arXiv:2312.00918 (check for the published version). ✅ (arXiv)** — maps statistical/neural code features to test execution times; compared to TEP-GNN. Supports "static code features carry performance signal".

**[E5] Zhou et al. — "DeepTLE: Learning code-level features to predict code performance before it runs", APSEC 2019. ◻**

**[E6] Jamshidi et al. — "Transfer learning for performance modeling of configurable systems: an exploratory analysis", ASE 2017, pp. 497–508. ◻** — relevant to projecting measurements from one environment (our calibrated host) to another (device profiles).

**[E7] Ghattas, Odeh, Mora — "Predicting Website Performance: A Systematic Review of Metrics, Methods, and Research Gaps (2010–2024)", Computers 14(10):446, 2025 (MDPI). ✅**
- *Findings:* 30 studies; load time, page size and response time dominate; only ~9% of studies use ML/DL; gaps include lack of standardized benchmarks and **insufficient public datasets**. Does not address JS dependency cost.
- *Relevance:* independent confirmation of the dataset gap. (MDPI venue — cite for its survey data, not as a quality signal.)

## 6. Theme F — Measuring performance reliably (noise, repetition, reproducibility)

**[F1] Laaber, Scheuner, Leitner — "Software microbenchmarking in the cloud. How bad is it really?", Empirical Software Engineering 24(4):2469–2508, 2019, doi:10.1007/s10664-019-09681-1. ✅**
- *Findings:* cloud environments add substantial variability; with appropriate designs, slowdowns can still be detected, and **Wilcoxon rank-sum detects smaller slowdowns** than alternatives in cloud settings.
- *Relevance:* justifies (i) not running measurements on shared cloud VMs if avoidable, (ii) interleaved/paired designs, (iii) non-parametric statistics.

**[F2] Heričko, Šumak, Brdnik — "Towards Representative Web Performance Measurements with Google Lighthouse", 2021 (University of Maribor; verify venue). ✅ (title/findings)**
- *Findings:* single-run Lighthouse measurements can be unrepresentative; **5 consecutive runs aggregated with the median** greatly reduce variability.
- *Relevance:* minimum bar for repetitions; our design goes further (paired, interleaved, k≥10, bootstrap CIs, A/A noise floor).

**[F3] Demir et al. — "Reproducibility and Replicability of Web Measurement Studies", WWW 2022, doi:10.1145/3485447.3512214. ✅ (venue/abstract) ◻ (author list)**
- *Findings:* survey of 117 papers — experimental setups essential for reproduction are often missing; a 4.5-million-page study with 24 setups shows the setup's influence on results.
- *Relevance:* our **reproducibility checklist** (Chromium version, flags, machine, calibration, host commits, package versions) comes from here.

**[F4] Lighthouse documentation — throttling & variability (grey literature). ✅** CPU throttling is relative to the host; `benchmarkIndex` for calibration; default mobile network 150 ms RTT / 1.6 Mbps.

## 7. Theme G — JavaScript performance issues in code

**[G1] Selakovic & Pradel — "Performance Issues and Optimizations in JavaScript: An Empirical Study", ICSE 2016, pp. 61–72, doi:10.1145/2884781.2884829. ✅**
- *Findings:* 98 fixed performance issues from 16 client- and server-side projects; eight root causes; **inefficient API usage** most prevalent; most fixes change only a few lines.
- *Relevance:* informs code features (API-usage signals) and reminds us that small code differences can matter — a limit of purely size-based proxies.

## 8. Theme H — Methods we borrow (cite in the method section)

- LightGBM (Ke et al., NeurIPS 2017) ◻ · SHAP (Lundberg & Lee, NeurIPS 2017) ◻ · TreeSHAP (Lundberg et al., Nature Machine Intelligence 2020) ◻
- Conformalized Quantile Regression (Romano, Patterson, Candès, NeurIPS 2019) ◻ · Gentle intro to conformal prediction (Angelopoulos & Bates, 2021) ◻
- Statistical testing for randomized SE experiments incl. Vargha–Delaney Â12 (Arcuri & Briand, ICSE 2011) ◻

---

## 9. Comparative summary table

| Ref | Level | Pre-integration? | Runtime (CPU) cost? | Per-dependency? | App context? | Prediction/ML? | Uncertainty? | Public data? |
|---|---|---|---|---|---|---|---|---|
| A1 WProf | page | ✗ | ✓ | ✗ | ✓ | ✗ (what-if) | ✗ | partial |
| A2 Nejati | page | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| A3 COZ+ | browser stage | ✗ | ✓ | ✗ | ✗ | ✗ (causal) | ✗ | ✓ tool |
| B1 JSCleaner | script | ✗ | ✓ | ✗ | ✓ | rules | ✗ | ✗ |
| B2 Muzeel | function | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | partial |
| B4 SlimWeb | script | ✗ | ✓ | ✗ | ✓ | ✓ classify | ✗ | ✗ |
| B5 Lacuna | function | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ |
| C1 Latendresse | dependency | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |
| C3 DepPrune | dependency | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |
| E1 DeepPerf | configuration | ✓ | ✓ | ✗ | — | ✓ | CI over runs | ✓ |
| E3 TEP-GNN | test file | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ |
| size-limit/estimo (tools) | bundle | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | — |
| Bundlephobia/bundlejs (tools) | package | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | — |
| **DepLens** | **dependency × app** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |

## 10. Research gaps (each tied to a contribution)

| # | Gap | Evidence | Our contribution |
|---|---|---|---|
| **G1** | No pre-integration estimate of a dependency's **runtime** cost; pre-install tools report bytes, runtime tools act after integration | §2 of doc 02; A1–A3 show runtime is what hurts; size-limit README concedes execution time is the more meaningful metric for large libs | Predictive model of ΔScript/ΔTBT from static + build information |
| **G2** | Cost is treated as a **property of the package**, not of the package-in-this-app (shared deps, exact imports, task merging) | Bundlephobia sizes whole packages; C1 shows production reality differs from declarations | Incremental-cost formulation; RQ1 quantifies the context effect |
| **G3** | **No public dataset** of measured per-dependency browser cost across apps | E7 lists insufficient public datasets; third-party-web exists only for CDN third parties | Open dataset (packages × hosts × profiles, with CIs), DOI on Zenodo |
| **G4** | ML performance prediction in SE targets configurable systems and unit tests; **cross-project generalization is known to be weak** | E1, E3 ("more work is needed … unseen projects") | Grouped evaluation on unseen packages *and* unseen apps; honest reporting |
| **G5** | Web-performance tooling rarely quantifies **measurement noise**; practitioners report instability | F1–F4; size-limit README + issue #110 | Paired interleaved protocol, A/A noise floor, bootstrap CIs, noise-aware metrics |
| **G6** | Tools give **point estimates** with no confidence and no **decision-level** evaluation (ranking, budgets) | doc 02 matrix | Conformal intervals; ranking and budget-violation evaluation; predict-then-verify savings |
| **G7** | Size is used as the default proxy for runtime cost without a systematic test of **how good a proxy it is** | Folk practice; V8 lazy parsing means non-linear relation | RQ2: a quantified answer, useful even if our model is only marginally better |

## 11. Positioning statement (paper-ready)

> Prior work either removes unnecessary JavaScript from already-deployed pages [B1–B5], characterises where browser time goes [A1–A3], or studies which npm dependencies are unused or reach production [C1–C3]. Performance-prediction research in software engineering targets configurable systems and test suites [E1–E4] and reports weak cross-project generalization [E3]. Developer tools report package bytes before adoption or measure whole-bundle runtime after it. We are, to our knowledge, the first to (i) define and measure the *incremental, context-dependent* browser cost of adopting an npm dependency, (ii) release a dataset of such measurements across multiple host applications with quantified noise, and (iii) predict it before integration with calibrated uncertainty, evaluated at the level of developer decisions.

## 12. References (IEEE style — convert via DBLP BibTeX)

[1] X. S. Wang, A. Balasubramanian, A. Krishnamurthy, D. Wetherall, "Demystifying page load performance with WProf," USENIX NSDI, 2013, pp. 473–485.
[2] J. Nejati, A. Balasubramanian, "An in-depth study of mobile browser performance," WWW, 2016, pp. 1305–1315.
[3] B. Pourghassemi, A. Amiri Sani, A. Chandramowlishwaran, "What-if analysis of page load time in web browsers using causal profiling," Proc. ACM Meas. Anal. Comput. Syst., vol. 3, no. 2, art. 27, 2019.
[4] M. Chaqfeh, Y. Zaki, J. Hu, L. Subramanian, "JSCleaner: De-cluttering mobile webpages through JavaScript cleanup," WWW, 2020, pp. 763–773.
[5] J. Kupoluyi et al., "Muzeel: Assessing the impact of JavaScript dead code elimination on mobile web performance," ACM IMC, 2022, pp. 335–348.
[6] M. Chaqfeh et al., "JSAnalyzer: A web developer tool for simplifying mobile web pages through non-critical JavaScript elimination," ACM Trans. Web, vol. 16, no. 4, art. 17, 2022.
[7] M. Chaqfeh et al., "To block or not to block: Accelerating mobile web pages on-the-fly through JavaScript classification," ACM ICTD, 2022.
[8] I. Malavolta et al., "JavaScript dead code identification, elimination, and empirical assessment," IEEE Trans. Softw. Eng., 2023.
[9] J. Latendresse, S. Mujahid, D. E. Costa, E. Shihab, "Not all dependencies are equal: An empirical study on production dependencies in NPM," IEEE/ACM ASE, 2022.
[10] N. R. Weeraddana, M. Alfadel, S. McIntosh, "Dependency-induced waste in continuous integration: An empirical study of unused dependencies in the npm ecosystem," Proc. ACM Softw. Eng., vol. 1, no. FSE, art. 116, 2024.
[11] Y. Liu et al., "Detecting and removing bloated dependencies in CommonJS packages," J. Syst. Softw., 2025.
[12] S. Mujahid, R. Abdalkareem, E. Shihab, "What are the characteristics of highly-selected packages? A case study on the npm ecosystem," J. Syst. Softw., vol. 198, 111588, 2023.
[13] S. Mujahid et al., "Where to go now? Finding alternatives for declining packages in the npm ecosystem," IEEE/ACM ASE, 2023, pp. 1628–1639.
[14] H. Ha, H. Zhang, "DeepPerf: Performance prediction for configurable software with deep sparse neural network," IEEE/ACM ICSE, 2019, pp. 1095–1106.
[15] N. Siegmund et al., "Performance-influence models for highly configurable systems," ESEC/FSE, 2015, pp. 284–294.
[16] H. P. Samoaa, A. Longa, M. Mohamad, M. H. Chehreghani, P. Leitner, "TEP-GNN: Accurate execution time prediction of functional tests using graph neural networks," PROFES, LNCS, Springer, 2022.
[17] "PACE: A program analysis framework for continuous performance prediction," arXiv:2312.00918.
[18] M. Ghattas, S. Odeh, A. M. Mora, "Predicting website performance: A systematic review of metrics, methods, and research gaps (2010–2024)," Computers, vol. 14, no. 10, 446, 2025.
[19] C. Laaber, J. Scheuner, P. Leitner, "Software microbenchmarking in the cloud. How bad is it really?," Empir. Softw. Eng., vol. 24, no. 4, pp. 2469–2508, 2019.
[20] L. Heričko, B. Šumak, S. Brdnik, "Towards representative web performance measurements with Google Lighthouse," 2021.
[21] N. Demir et al., "Reproducibility and replicability of web measurement studies," WWW, 2022.
[22] M. Selakovic, M. Pradel, "Performance issues and optimizations in JavaScript: An empirical study," IEEE/ACM ICSE, 2016, pp. 61–72.
[23] G. Ke et al., "LightGBM: A highly efficient gradient boosting decision tree," NeurIPS, 2017.
[24] S. M. Lundberg, S.-I. Lee, "A unified approach to interpreting model predictions," NeurIPS, 2017.
[25] Y. Romano, E. Patterson, E. Candès, "Conformalized quantile regression," NeurIPS, 2019.
[26] A. Arcuri, L. Briand, "A practical guide for using statistical tests to assess randomized algorithms in software engineering," ICSE, 2011.
[27] V8 team, "The cost of JavaScript in 2019," v8.dev; "Blazingly fast parsing, part 2: lazy parsing," v8.dev; "Explicit compile hints," v8.dev, 2025.
[28] GoogleChrome/lighthouse, docs/throttling.md and docs/variability.md.

## Sources consulted online for this review
- [WProf (USENIX)](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/wang_xiao) · [Nejati & Balasubramanian (ACM DL)](https://dl.acm.org/doi/10.1145/2872427.2883014) · [COZ+ (ACM DL)](https://dl.acm.org/doi/abs/10.1145/3341617.3326142)
- [JSCleaner (ACM DL)](https://dl.acm.org/doi/10.1145/3366423.3380157) · [Muzeel (ACM DL)](https://dl.acm.org/doi/10.1145/3517745.3561427) · [JSAnalyzer (DBLP)](https://dblp.org/rec/journals/tweb/ChaqfehCHHSRZ22.html) · [SlimWeb (arXiv)](https://arxiv.org/abs/2106.13764) · [Lacuna / TSE (arXiv)](https://arxiv.org/abs/2308.16729)
- [Latendresse et al. (arXiv)](https://arxiv.org/abs/2207.14711) · [Weeraddana et al. (ACM DL)](https://dl.acm.org/doi/full/10.1145/3660823) · [DepPrune (arXiv)](https://arxiv.org/abs/2405.17939)
- [Mujahid et al. JSS (arXiv)](https://arxiv.org/abs/2204.04562)
- [DeepPerf (ACM DL)](https://dl.acm.org/doi/10.1109/ICSE.2019.00113) · [TEP-GNN (arXiv)](https://arxiv.org/abs/2208.11947) · [PACE (arXiv)](https://arxiv.org/pdf/2312.00918) · [Ghattas et al. (MDPI)](https://www.mdpi.com/2073-431X/14/10/446)
- [Laaber et al. (Springer)](https://link.springer.com/article/10.1007/s10664-019-09681-1) · [Heričko et al. (Semantic Scholar)](https://www.semanticscholar.org/paper/Towards-Representative-Web-Performance-Measurements-Heri%C4%8Dko-%C5%A0umak/9e1917690f95b4ccc615db965f6640e78b73fc80) · [Demir et al. (ACM DL)](https://dl.acm.org/doi/10.1145/3485447.3512214)
- [Selakovic & Pradel (ACM DL)](https://dl.acm.org/doi/10.1145/2884781.2884829)
- [V8: cost of JavaScript 2019](https://v8.dev/blog/cost-of-javascript-2019) · [V8: lazy parsing](https://v8.dev/blog/preparser) · [V8: explicit compile hints](https://v8.dev/blog/explicit-compile-hints)
