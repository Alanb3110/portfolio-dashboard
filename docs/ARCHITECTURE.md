# v5 architecture

## Objective

Portfolio Dashboard v5 is a local-first, iPhone-first PWA. It replaces the frozen Python/dashboard pipeline with a browser application whose deterministic portfolio calculations do not require network access.

## Trust boundary

```text
Trade Republic PDF + CSV
        |
        v
   browser memory
        |
        +--> parser / ledger / analytics
        |
        +--> dashboard

No personal portfolio payload crosses the network boundary.
```

The current foundation intentionally has no external `connect-src` permission and no persistence of imported personal data.

## Analytical scope

- Main portfolio: Compte-titres + PEA.
- Extended invested portfolio: main + Wallet Crypto.
- Total Trade Republic net worth: main + crypto + private markets + cash.
- Crypto, private markets and cash are not part of the main equity benchmark comparison.

## v5 simplification relative to v4

Critical path:

1. current portfolio value;
2. simple economic P&L;
3. XIRR / money-weighted return;
4. allocation and concentration from official snapshots;
5. progression between imported official snapshots;
6. lightweight World / S&P 500 comparison.

Deliberately not required for v5 correctness:

- daily reconstructed historical NAV since 2023;
- exhaustive historical market-price backfill for every instrument;
- daily TTWROR as a headline metric;
- realized volatility / Sharpe computed from a sparse reconstructed NAV.

## Network layer

A market-data adapter will be added after the deterministic local core is accepted. Its interface must accept only public market identifiers/dates. It must never receive holdings, quantities, transaction rows, portfolio values or imported files.

## Persistence

Foundation behavior: in-memory only.

A later persistence layer may store normalized snapshots in IndexedDB, but only after explicit backup/erase controls and a privacy review are implemented.
