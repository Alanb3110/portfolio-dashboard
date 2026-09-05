# Portfolio Dashboard v5

Local-first portfolio analysis PWA for Trade Republic exports.

## Principles

- **Personal data stays on the device.** Net Worth PDFs, transaction CSVs and transaction history are processed locally and are never uploaded by the application.
- **Main portfolio = Compte-titres + PEA.** Crypto, private markets and cash remain separate.
- **Simple, robust analytics first.** v5 prioritizes current value, P&L, XIRR, allocation, snapshot history and a lightweight World / S&P 500 comparison.
- **No reconstructed daily TTWROR requirement.** Historical daily NAV backfill is deliberately out of the v5 critical path.
- **iPhone-first.** The application is designed as an installable PWA with local file import.

## Status

The PWA is deployed through GitHub Pages and the deterministic local core is operational. Trade Republic PDF/CSV parsing, main-scope normalization, economic P&L and XIRR are covered by synthetic tests and CI.

Derived snapshot history is persisted only after an explicit user action in IndexedDB; raw PDF/CSV bytes and the normalized transaction ledger are not stored. World and S&P 500 benchmarks are matched-flow forward comparisons initialized from the first local v5 snapshot. Market prices are obtained through a restricted Cloudflare Worker that accepts only the public benchmark IDs and date ranges; the EODHD API token remains a Cloudflare runtime secret.

The benchmark layer is deliberately non-blocking: a provider/network failure must never prevent the local portfolio analysis from rendering.

## Local development

```bash
npm install
npm run check
npm run dev
```

## Security rule

Never commit Trade Republic exports, exported backups or derived personal portfolio data. The repository contains only code, public instrument metadata and synthetic test fixtures.
