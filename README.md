# Portfolio Dashboard v5

Local-first portfolio analysis PWA for Trade Republic exports.

## Principles

- **Personal data stays on the device.** Net Worth PDFs, transaction CSVs, positions, quantities and NAV must never be committed or uploaded by the application.
- **Main portfolio = Compte-titres + PEA.** Crypto, private markets and cash remain separate.
- **Simple, robust analytics first.** v5 prioritizes current value, P&L, XIRR, allocation, snapshot history and a lightweight World / S&P 500 comparison.
- **No reconstructed daily TTWROR requirement.** Historical daily NAV backfill is deliberately out of the v5 critical path.
- **iPhone-first.** The application is designed as an installable PWA with local file import.

## Status

The `feat/v5-foundation` branch contains the first v5 implementation. It currently establishes the privacy boundary, local Trade Republic CSV/PDF ingestion, synthetic financial tests and the mobile PWA shell. Market-data adapters and benchmark comparison are intentionally a later layer.

## Local development

```bash
npm install
npm run check
npm run dev
```

## Security rule

Never commit Trade Republic exports or derived personal portfolio data. The repository contains only code, public instrument metadata and synthetic test fixtures.
