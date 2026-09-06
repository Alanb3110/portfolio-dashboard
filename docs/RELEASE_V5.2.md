# Portfolio Dashboard v5.2.0 — release record

Status: **release candidate — pending final iPhone validation**  
Application/package version: **5.2.0**  
Financial methodology version: **5.1 (unchanged)**  
Baseline: `frozen/v5.1.0` / `92ca8f61bdfd25c5733357789ed63425ec61f292`

## Release intent

v5.2 is a product, robustness and maintainability release. It does **not** redefine the financial engine validated in v5.1.

The user-facing objective is:

> update once → understand the latest observed period → decide how to allocate the next contribution

## Financial conventions preserved

The following v5.1 conventions are unchanged:

- main portfolio = Compte-titres + PEA;
- crypto excluded from main performance/benchmark comparison and shown separately;
- private markets and cash excluded from main performance;
- canonical main cash-flow mapping and signs;
- economic P&L convention;
- XIRR and 365-day basis;
- strict cutoff at the official Net Worth snapshot date;
- forward matched-flow MSCI World / S&P 500 benchmarks;
- identical baseline value and subsequent cash-flow schedule for portfolio/benchmarks;
- incremental local benchmark checkpoints and look-ahead protection;
- snapshot-only historical observations;
- no reconstructed daily NAV or TTWROR backfill.

Any future change to those rules remains a methodology-version change and is outside this release.

## Product changes

### One-tap iPhone workflow

The primary action is now `Actualiser et enregistrer`:

1. inspect the selected local folder;
2. choose the financially most recent valid Trade Republic PDF/CSV sources;
3. run the existing local analysis;
4. store the derived History v2 snapshot locally.

Manual `Analyser sans enregistrer` and manual snapshot save remain available. Raw source files and the normalized ledger are still not persisted.

### Safer folder-source selection

A re-downloaded older file can no longer silently win solely because its filesystem `lastModified` is newer.

- Net Worth candidates are ranked by parsed official snapshot date;
- CSV candidates are ranked by transaction coverage;
- unreadable matching candidates are ignored with explicit feedback;
- refresh refuses an accidental regression behind the newest saved local snapshot.

### Performance between observed snapshots

For compatible observed snapshots, v5.2 separates:

- flow-adjusted economic P&L;
- net money invested/withdrawn from the main holdings scope;
- raw portfolio-value change.

The direct period identity is:

`period P&L = terminal value - starting value + canonical cash flows in (T0, T1]`

Stored-history presentation is conservative: it is shown only when the two records are methodology 5.1 and have compatible known ledger coverage. Otherwise it is `N/A` rather than inferred.

### Contribution-first rebalancing

Given an explicitly entered EUR contribution and user-defined target weights, the dashboard produces a buy-only mechanical allocation:

- no negative purchase;
- no implicit sale;
- purchases sum to the entered contribution within numerical tolerance;
- projected post-contribution weights/drift are shown.

Whole-share constraints, execution prices, fees and tax are deliberately not modelled.

### Allocation / concentration clarity

Concentration is explicitly labelled at portfolio-line level:

- Top 1 ligne;
- Top 3 lignes;
- HHI lignes;
- equivalent number of lines.

An ETF remains one line; these metrics must not be interpreted as look-through economic diversification of ETF constituents.

### Sparse-history UX

The history remains based only on saved observations. v5.2 adds larger touch targets and an exact snapshot inspector for portfolio / MSCI World / S&P 500 values. Missing benchmark observations remain missing; no interpolation is introduced.

## Maintainability and test changes

- added a built-production UI integration smoke test using synthetic data only;
- authoritative parsed snapshot is shared across UI modules instead of being reparsed independently for allocation;
- deterministic single application entry point replaces five independent module entries;
- unnecessary startup observers/panel-order assumptions were reduced while runtime rerender observers were retained where needed.

## Automated validation before RC

Latest pre-release implementation CI:

- TypeScript typecheck: PASS;
- Vitest: **97 tests / 14 files PASS**;
- PWA smoke: PASS;
- built-production UI smoke: PASS;
- IndexedDB reload continuity in UI smoke: PASS;
- Worker smoke: PASS;
- Wrangler config mirror check: PASS;
- Wrangler deployment dry-run: PASS;
- npm audit during CI install: 0 reported vulnerabilities.

The built JS entry is approximately 517 kB minified / 155 kB gzip. Vite therefore emits its >500 kB advisory. This is recorded as a non-blocking performance/maintainability observation, not a financial or functional failure; no code-splitting change is introduced solely to silence the warning before real-device evidence warrants it.

## Privacy boundary

Unchanged from v5.1:

- PDF/CSV remain local;
- raw ledger is not persisted;
- only derived history/checkpoints/target configuration are stored locally;
- Worker requests contain benchmark ID + date range only;
- no personal holding, flow, NAV, P&L or XIRR data is sent to Cloudflare/EODHD.

## Production infrastructure

No Worker methodology/provider change is part of v5.2. The existing EODHD-backed restricted Cloudflare Worker, `/health` readiness semantics, canonical cache, rate limiter, Wrangler pin and root/worker config synchronization remain in place.

## Final release gate

Before changing this document to **frozen/validated** and creating `frozen/v5.2.0`, complete the following on the deployed `main` build:

- [ ] GitHub Pages deploy green for the 5.2.0 candidate;
- [ ] Cloudflare production build/readiness healthy;
- [ ] installed iPhone PWA visibly reports v5.2;
- [ ] `Actualiser et enregistrer` succeeds with current Trade Republic exports;
- [ ] same-date repeat refresh does not create duplicate history;
- [ ] closing/reopening the PWA preserves derived history;
- [ ] MSCI World and S&P 500 remain populated/non-blocking;
- [ ] allocation tabs and line-level concentration render correctly;
- [ ] next-contribution planner accepts a test amount and returns buy-only EUR suggestions;
- [ ] sparse-history touch inspection works on real iPhone;
- [ ] manual `Analyser sans enregistrer` remains available;
- [ ] no unexpected privacy/network behavior is observed.

After successful manual validation, record the final `main` commit here, create immutable branch `frozen/v5.2.0`, and optionally tag/release `v5.2.0`.
