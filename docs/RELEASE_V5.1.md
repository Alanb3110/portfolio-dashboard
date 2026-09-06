# Portfolio Dashboard v5.1 — frozen release record

Freeze date: **2026-09-06**  
Package version: **5.1.0**  
Methodology version: **5.1**

## Frozen product scope

The primary analytical scope is the **main portfolio = Compte-titres + PEA**. Crypto is separate, private assets are separate, and cash is informational rather than part of investment performance.

Headline performance uses economic P&L and XIRR. The application deliberately does not reconstruct a daily portfolio NAV or TTWROR history.

Historical evolution is snapshot-driven: only snapshots actually saved by the user are plotted. No daily interpolation is presented as observed portfolio history.

## Benchmark methodology

Primary benchmarks are synthetic forward matched-flow comparisons:

- MSCI World proxy: EUNL.XETRA / IE00B4L5Y983;
- S&P 500 proxy: SXR8.XETRA / IE00B5BMR087.

At the baseline snapshot, the benchmark starts with the same value as the main portfolio. Subsequent canonical main cash flows are replayed causally into the benchmark. Benchmark checkpoints are stored with derived snapshots so normal operation does not require rebuilding the full historical price series.

Only public benchmark identifiers and date windows are sent to the market Worker. Holdings, quantities, NAV, transaction rows and source files stay on-device.

For periods shorter than 30 days, aligned XIRR is intentionally hidden because annualization is not decision-useful. Terminal matched-flow values and euro/percentage gaps remain displayed; the UI therefore reports `WARN` rather than pretending a long-horizon return estimate is meaningful.

## Integrity controls frozen in v5.1

- PDF pocket totals reconcile against the official Trade Republic summary.
- Main position quantities reconcile ledger vs official PDF snapshot using `(pocket, symbol)` identities.
- Transactions after the PDF snapshot date are excluded from performance calculations.
- Invalid dates/datetimes and duplicate or empty transaction IDs fail visibly.
- Unknown Trade Republic taxonomy values that could affect main investment performance fail visibly instead of silently falling through to cash.
- Canonical main cash flows must be EUR under the current methodology.
- History schema v2 records methodology version, source fingerprint, raw-ledger first/last dates and analytical cutoff without persisting raw transactions.
- Benchmark pricing prevents future-price look-ahead and handles non-trading-day flows causally.

## Deployment and privacy boundary

The static PWA is deployed on GitHub Pages. The Cloudflare Worker is a narrow public-market gateway only.

Worker safeguards include:

- fixed benchmark allow-list;
- strict query-parameter allow-list;
- canonical cache keys;
- 370-day request cap;
- shared rate limiter before upstream EODHD calls;
- EODHD token stored only as a Cloudflare secret;
- `/health` readiness check for provider secret and rate-limiter binding;
- mirrored root and `/worker` Wrangler configurations with CI equivalence checking;
- Wrangler pinned to 4.129.0 on the repository-root deployment path;
- `wrangler deploy --dry-run` in CI.

## Validation record

Automated validation covers TypeScript typechecking, synthetic financial tests, ingestion/parser tests, reconciliation, benchmark replay/checkpoints, allocation, rebalancing, history, PWA precache and Worker smoke tests.

Manual production validation on iPhone confirmed:

- folder refresh/import works;
- derived history persists across reopening;
- offline reopening works;
- MSCI World and S&P 500 synthetic values render through the production Worker;
- portfolio-vs-benchmark gaps render;
- the sparse historical chart includes the benchmark observations.

No private Trade Republic source file, portfolio value screenshot or derived personal backup is committed as release evidence.

## Change-control rule after freeze

Any future change to portfolio scope, canonical cash-flow mapping, XIRR convention, benchmark replay rules, checkpoint semantics or history methodology requires an explicit methodology-version decision rather than a silent v5.1 change.

Bug fixes, compatibility fixes and UI improvements may remain within the v5.1 line only if they preserve those frozen financial conventions.
