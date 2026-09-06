# Portfolio Dashboard v5.2

Local-first portfolio analysis PWA for Trade Republic exports.

## Principles

- **Personal data stays on the device.** Net Worth PDFs, transaction CSVs and transaction history are processed locally and are never uploaded by the application.
- **Main portfolio = Compte-titres + PEA.** Crypto, private markets and cash remain separate.
- **Financial methodology remains 5.1.** v5.2 changes product UX, robustness and decision-support presentation without changing the frozen portfolio scope, canonical cash-flow mapping, XIRR convention, benchmark replay/checkpoints or snapshot-only history methodology.
- **No reconstructed daily TTWROR requirement.** Historical daily NAV backfill remains deliberately outside the critical path.
- **iPhone-first.** The primary workflow is one explicit action: `Actualiser et enregistrer`.

## Status — v5.2.0 release candidate

v5.1 was frozen on 2026-09-06 after contradictory audit, CI coverage and live iPhone validation. Its immutable reference remains `frozen/v5.1.0` at commit `92ca8f61bdfd25c5733357789ed63425ec61f292`.

v5.2.0 has completed the planned code/CI work and is in release-candidate validation. It must not be frozen as `frozen/v5.2.0` until the deployed build has passed the final real-iPhone workflow check.

v5.2 adds, without changing financial methodology:

- semantic folder refresh based on actual statement/transaction recency rather than filesystem timestamps alone;
- one-tap `Actualiser et enregistrer` with manual analysis as a fallback;
- flow-adjusted economic performance between compatible observed snapshots;
- buy-only guidance for allocating a user-entered next contribution against local target weights;
- explicit line-level concentration wording (`Top 1 ligne`, `Top 3 lignes`, `HHI lignes`);
- touch-friendly inspection of sparse historical portfolio/benchmark observations;
- built-production UI integration smoke coverage and a deterministic single application entry point.

Validated automated path:

- local Trade Republic PDF/CSV import and strict temporal cutoff at the PDF snapshot date;
- main-position quantity reconciliation against the official snapshot;
- economic P&L and XIRR;
- snapshot-only history and provenance checks;
- forward matched-flow MSCI World and S&P 500 benchmarks through the restricted Cloudflare Worker;
- benchmark checkpoints that avoid a daily-NAV/backfill dependency;
- allocation/concentration and contribution-first rebalancing views;
- PWA offline shell and IndexedDB history continuity;
- Cloudflare readiness, quota hardening, pinned Wrangler deployment and config-mirror validation;
- built-production UI smoke against the Vite artifact.

Raw PDF/CSV bytes and the normalized transaction ledger are never persisted. History v2 stores only derived values plus local source fingerprint and audited ledger date bounds. Benchmark/network failures remain non-blocking for local portfolio analysis.

See `docs/RELEASE_V5.1.md` for the immutable v5.1 baseline, `docs/V5.2_PLAN.md` for the v5.2 design guardrails, and `docs/RELEASE_V5.2.md` for the release-candidate validation record.

## Local development

```bash
npm ci
npm run check
npm run dev
```

## Security rule

Never commit Trade Republic exports, exported backups or derived personal portfolio data. The repository contains only code, public instrument metadata and synthetic test fixtures.
