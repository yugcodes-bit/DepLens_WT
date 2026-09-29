# 11 — Paper Plan

## Working titles
- *DepLens: Predicting the Incremental Browser Cost of npm Dependencies Before Integration*
- *Is Bundle Size Enough? Measuring and Predicting the Runtime Cost of Adding JavaScript Dependencies to Web Applications*
(Pick after the pilot — the second title fits if RQ2 dominates.)

## Target format
ICWE full paper: 15 pages Springer LNCS incl. references (NIER: 8). EASE/ACM: check the 2027 CFP (typically 10 pages ACM format). Write for LNCS first; it's the tighter budget.

## Outline (≈ page budget for LNCS)
1. **Introduction (1.5 pp)** — the decision problem; bytes ≠ runtime; cost depends on the app; tools act too late or measure the wrong thing; contributions list (formulation, protocol + dataset, findings, model, tool).
2. **Background & motivating example (1 p)** — V8 lazy parsing/eager compile; TBT threshold; one concrete pair of packages where size ranking ≠ runtime ranking (from the pilot).
3. **Problem formulation (0.75 p)** — ΔC(H, P, I, D), C_iso, context effect; metrics; scope.
4. **Measurement methodology (2 pp)** — injection + sink; paired interleaved sessions; HL + bootstrap; A/A MDE; injected-cost validation; profiles & calibration; network model.
5. **Dataset (1 p)** — corpus, hosts, compatibility matrix, statistics, availability.
6. **Prediction approach (1.5 pp)** — features (grouped, V8-grounded), baselines B0–B4, LightGBM + monotone constraints, conformal intervals, TreeSHAP, analytic ΔTBT.
7. **Evaluation (4 pp)** — RQ1 context effect; RQ2 size proxies; RQ3 accuracy on S2/S3/S4 with statistics; RQ4 ranking, budgets, predict-then-verify curve; RQ5 feature effects + case studies.
8. **Tool (0.75 p)** — architecture figure, screenshot, CLI.
9. **Threats to validity (0.75 p)** — below.
10. **Related work (1 p)** — doc 03 themes A–G condensed.
11. **Conclusion (0.25 p)** + data/code availability statement + generative-AI disclosure if required by the venue.

## Key figures & tables
- Fig. 1: motivating example (size rank vs runtime rank for one alternative group).
- Fig. 2: pipeline / architecture.
- Fig. 3: injected-cost validation (measured vs injected N ms) + A/A distribution.
- Fig. 4: context effect distribution (ΔC vs C_iso), split by shared-dependency cases.
- Table 1: dataset summary. Table 2: RQ3 results (S2/S3/S4 × models/baselines with CIs, significance, Â12).
- Fig. 5: predict-then-verify curve. Fig. 6: SHAP summary by feature group.

## Threats to validity (draft)
- **Construct:** lab ΔScript/ΔTBT under emulation as a proxy for user experience; INP excluded; load-time only.
- **Internal:** measurement noise (mitigated by pairing, A/A, CIs); build-tool versions; order effects; single-machine bias.
- **External:** Chromium only; Vite/Rollup/esbuild only; corpus biased toward popular packages; host apps may not represent large production apps.
- **Conclusion:** multiple comparisons (Holm); clustered data (cluster bootstrap); small number of hosts for leave-one-host-out.

## Artifact
Zenodo: dataset (Parquet + dictionary), harness code, host apps (pinned), trained models, `make paper-tables`. Link in the paper; ICPE/others also have artifact-evaluation tracks.

## Writing checklist
- [ ] Every number in the paper produced by a script in `ml/` or `research/`.
- [ ] Re-run literature search (doc 03 §0) within 2 weeks of submission.
- [ ] Check venue policy on prior publication (if a workshop version exists) and on generative-AI disclosure.
- [ ] Internal review by someone outside the team.
