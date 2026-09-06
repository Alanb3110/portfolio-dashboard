# Portfolio Dashboard v5.2.0 — release record

Status: **validated — ready for immutable freeze**  
Application/package version: **5.2.0**  
Financial methodology version: **5.1 (unchanged)**  
Historical baseline retained: `frozen/v5.1.0` / `92ca8f61bdfd25c5733357789ed63425ec61f292`  
Validated implementation commit: `8e0275547e733c7f6fc2232fa7a603e387a5598f`

Detailed evidence: [`docs/VALIDATION_V5.2.md`](./VALIDATION_V5.2.md)

## Release intent

v5.2 is a product, robustness and maintainability release. It does **not** redefine the financial methodology validated in v5.1.

The final release priority is reliability on the iPhone-first local workflow rather than additional analytical complexity.

## Financial conventions preserved

The following v5.1 conventions remain unchanged:

- main portfolio = Compte-titres + PEA;
- crypto excluded from main performance/benchmark comparison and analysed separately;
- private markets and cash excluded from main performance;
- canonical main cash-flow mapping and signs;
- economic P&L convention;
- XIRR and 365-day basis;
- strict cutoff at the official Net Worth snapshot date;
- forward matched-flow MSCI World / S&P 500 benchmarks;
- identical baseline value and subsequent canonical cash-flow schedule for portfolio/benchmarks;
- incremental local benchmark checkpoints and look-ahead protection;
- snapshot-only historical observations;
- no reconstructed daily NAV or TTWROR backfill.

Any future modification of scope, cash-flow semantics, benchmark replay/checkpoint semantics, price-date causality or XIRR convention requires an explicit methodology-version decision.

## Final iPhone import workflow

The validated folder workflow is deliberately strict:

- exactly one matching `Net Worth.pdf`;
- exactly one matching `Transaction export.csv`;
- suffixed Trade Republic download names remain accepted when unambiguous;
- multiple matching PDFs or CSVs are rejected rather than inspected/ranked automatically;
- manual two-file analysis remains available;
- raw PDF/CSV files are never persisted by Portfolio Dashboard.

`Actualiser et enregistrer` is a single-pass workflow:

1. select the unique PDF/CSV pair;
2. read and analyse it once;
3. render the local analysis once;
4. persist the derived snapshot without forcing a second analysis render.

## v5.2 robustness corrections

### PERF-1 — PR #59

- removed Allocation/Rebalancing render loops driven by result-container MutationObservers;
- stopped idle DOM/microtask/IndexedDB churn from those modules.

### PERF-2 — PR #60

- verbose diagnostics disabled by default;
- diagnostics remain explicitly available with `?diagnostics=1`;
- no normal-runtime diagnostic heartbeat/observer/logging loop.

### PERF-3 — PR #62

- folder refresh made single-pass;
- no second `renderAnalysis()` after persistence;
- no duplicate World/S&P benchmark launch caused by the refresh path;
- busy state remains active through the complete workflow.

### CLEAN-1 — PR #63

- removed abandoned multi-export import paths;
- removed the old SHA-256 file fingerprint path;
- removed the unused FileReader helper and obsolete tests;
- preserved the validated iPhone bootstrap and strict one-PDF/one-CSV workflow.

### Benchmark partial-data correction — PR #65

Depth validation found one P0 correctness issue: a missing weekday flow-date benchmark price could be silently replaced by the next available close.

The corrected conservative behavior is:

- exact flow-date close when available;
- weekend flow may use the first causal close after the flow date;
- missing weekday flow-date close -> benchmark `N/A`;
- no future close is used.

This preserves matched-flow semantics while preventing an interior provider-data gap from being reported as a valid `PASS` benchmark.

A weekday Xetra holiday without a close is therefore conservatively `N/A` in the absence of an authoritative exchange-calendar dependency. This is an accepted availability limitation, not silent interpolation.

## History and period interpretation

Historical portfolio evolution remains sparse and observational: only saved official snapshots are shown.

For two compatible methodology-5.1 snapshots sharing the same known ledger start date, v5.2 can derive period economic P&L from the frozen cumulative convention. If ledger coverage is unknown or changes, period performance is explicitly `N/A`.

Missing historical benchmark observations remain missing. The chart does not invent intermediate benchmark or portfolio observations.

## Allocation and rebalancing

Allocation/concentration remains line-level rather than ETF look-through:

- Top 1 line;
- Top 3 lines;
- HHI lines;
- equivalent number of lines.

Contribution steering remains buy-only:

- explicit user-entered EUR contribution;
- no negative purchase;
- no implicit sale;
- deterministic target-weight steering;
- whole-share execution, fees and tax are not modelled.

## Deterministic depth validation

The final validation suite adds deterministic financial and runtime evidence without using real user data or Internet market data.

Validated cases include:

- 30-snapshot history ordering, latest/previous selection, raw variation and sparse benchmark points;
- contribution and withdrawal/sale cash-flow signs;
- independently calculated MSCI World and S&P 500 matched-flow terminal values;
- incomplete benchmark data and no-price cases;
- compatible/incompatible/unknown ledger start dates;
- allocation weights, Top1, Top3, HHI and equivalent N;
- current rebalancing and buy-only semantics;
- isolated IndexedDB save, same-date overwrite, reload, backup round-trip/import and erase;
- no raw source keys persisted by History;
- 100-snapshot import/reload and built-PWA rendering;
- exact selection of an intermediate history point;
- bounded DOM and observer activity;
- zero continuing MutationObserver/IndexedDB/DOM growth after stabilization;
- single folder-analysis pipeline and single benchmark-panel orchestration invariant.

Final depth run observations:

- **110 tests / 19 files PASS**;
- 100 saved synthetic snapshots rendered;
- **442 DOM nodes** in the built 100-snapshot test;
- **4 MutationObserver instances**;
- **15 observer callbacks during initialization**;
- **5 IndexedDB opens after instrumentation**;
- callback count, IndexedDB opens and DOM-node count remain unchanged during the idle observation window.

These counts are CI regression invariants, not direct measurements of iPhone CPU load or temperature.

## Real-device validation

After PERF-1 / PERF-2 / PERF-3 / CLEAN-1, validation on a real iPhone reported:

- correct application opening;
- correct import and analysis;
- correct snapshot persistence;
- fluid navigation;
- no abnormal heating observed;
- no obvious lag observed;
- no crash / black screen observed during the validation session.

The previous iPhone stability regression is therefore considered corrected unless new contrary evidence appears.

## Automated release gate

On the validated implementation commit `8e0275547e733c7f6fc2232fa7a603e387a5598f`:

- TypeScript typecheck: **PASS**;
- Vitest: **110 / 110 PASS**;
- PWA smoke: **PASS**;
- built-production UI smoke: **PASS**;
- deterministic depth smoke: **PASS**;
- isolated IndexedDB lifecycle: **PASS**;
- 100-snapshot volume test: **PASS**;
- idle render/storage stability invariant: **PASS**;
- Worker smoke: **PASS**;
- Wrangler config mirror check: **PASS**;
- Wrangler deployment dry-run: **PASS**;
- post-merge `main` CI: **PASS**;
- GitHub Pages build: **PASS**;
- GitHub Pages deploy: **PASS**.

The production bundle still emits Vite's >500 kB advisory. No code splitting is introduced solely to silence that warning because the validated real-device behavior is good and this release deliberately avoids unnecessary complexity.

## Privacy boundary

Unchanged from v5.1:

- PDF/CSV remain local;
- raw ledger is not persisted;
- only derived history/checkpoints/target configuration are stored locally;
- Worker requests contain benchmark ID + bounded date range only;
- no personal holding, flow, NAV, P&L or XIRR payload is sent to Cloudflare/EODHD.

## Production infrastructure

No Worker or EODHD implementation change was required for the v5.2 depth-validation correction. The existing restricted Cloudflare market proxy remains unchanged.

## Freeze decision

**A — Portfolio Dashboard v5.2.0 is ready to be frozen.**

Freeze policy:

- preserve `frozen/v5.1.0` unchanged;
- merge this release record with CI green;
- create `frozen/v5.2.0` at the resulting release-record commit;
- create tag/release `v5.2.0` at the same commit when available;
- treat that reference as immutable.
