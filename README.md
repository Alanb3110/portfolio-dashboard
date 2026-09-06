# Portfolio Dashboard v5.1 / v5.2 development

Local-first portfolio analysis PWA for Trade Republic exports.

## Principles

- **Personal data stays on the device.** Net Worth PDFs, transaction CSVs and transaction history are processed locally and are never uploaded by the application.
- **Main portfolio = Compte-titres + PEA.** Crypto, private markets and cash remain separate.
- **Simple, robust analytics first.** v5.1 prioritizes current value, economic P&L, XIRR, allocation/concentration, snapshot history, rebalancing guidance and World / S&P 500 context.
- **No reconstructed daily TTWROR requirement.** Historical daily NAV backfill remains deliberately outside the critical path.
- **iPhone-first.** The application is designed as an installable PWA with local folder refresh and manual file fallback.

## Status — v5.1 frozen, v5.2 in development

v5.1 was frozen on 2026-09-06 after a contradictory audit, synthetic CI coverage and live iPhone validation.

The immutable v5.1 reference is `frozen/v5.1.0` at commit `92ca8f61bdfd25c5733357789ed63425ec61f292`.

v5.2 development must preserve the frozen v5.1 financial methodology unless an explicit methodology-version decision is made. Product/UX, testing, robustness and maintainability work may continue without changing portfolio scope, canonical cash-flow mapping, XIRR convention, benchmark replay/checkpoint semantics or snapshot-only history methodology.

Validated production path:

- local Trade Republic PDF/CSV import and folder refresh;
- strict temporal cutoff at the PDF snapshot date;
- main-position quantity reconciliation against the official snapshot;
- economic P&L and XIRR;
- snapshot-based historical evolution;
- forward matched-flow MSCI World and S&P 500 benchmarks through the restricted Cloudflare Worker;
- benchmark checkpoints that avoid a daily-NAV/backfill dependency;
- allocation/concentration and local rebalancing views;
- PWA offline shell and update flow;
- Cloudflare readiness, quota hardening, pinned Wrangler deployment and GitHub Pages deployment.

The final live validation confirmed that both synthetic benchmarks render usable values in the installed iPhone PWA. A short-period `WARN` is expected while aligned XIRR is intentionally hidden for periods under 30 days; it is not a provider failure.

Derived snapshot history is stored in IndexedDB only after explicit user action. Raw PDF/CSV bytes and the normalized transaction ledger are not persisted. History v2 records only derived values plus a local source fingerprint and audited ledger date bounds for reproducibility.

The benchmark layer remains non-blocking: a provider/network failure must never prevent the local portfolio analysis from rendering.

See `docs/RELEASE_V5.1.md` for the frozen scope and validation record and `docs/V5.2_PLAN.md` for the current product-development guardrails.

## Local development

```bash
npm ci
npm run check
npm run dev
```

## Security rule

Never commit Trade Republic exports, exported backups or derived personal portfolio data. The repository contains only code, public instrument metadata and synthetic test fixtures.
