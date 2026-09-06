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
        |          |
        |          +--> optional derived snapshot --> IndexedDB on this device
        |
        +--> dashboard

public benchmark IDs + coarse date range
        |
        v
Cloudflare market Worker --> EODHD
```

No personal portfolio payload crosses the network boundary. The Worker receives only one of the two fixed public benchmark IDs and a bounded date range.

Raw PDF/CSV bytes and the normalized transaction ledger are not persisted by the application. Snapshot persistence is explicit: the user must deliberately save a derived snapshot. v5.2 may combine refresh and save into one clearly labelled action; this does not change what is persisted.

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
6. forward matched-flow World / S&P 500 comparison.

Deliberately not required for v5 correctness:

- daily reconstructed historical NAV since 2023;
- exhaustive historical market-price backfill for every instrument;
- daily TTWROR as a headline metric;
- realized volatility / Sharpe computed from a sparse reconstructed NAV.

## Network layer

The production market-data path is a restricted Cloudflare Worker backed by EODHD.

The browser adapter accepts only the fixed public MSCI World / S&P 500 benchmark definitions and date windows. The Worker maps those IDs to the fixed Xetra proxies, applies validation/caching/rate limiting and returns sanitized `date` + `adjustedClose` rows.

It must never receive holdings, quantities, transaction rows, portfolio values, source fingerprints or imported files. A Worker/provider failure remains isolated from deterministic local portfolio analysis.

See `docs/BENCHMARK.md` and `worker/README.md` for the frozen benchmark and deployment details.

## Persistence

IndexedDB stores only a versioned derived snapshot containing:

- snapshot date and save timestamp;
- methodology version and ledger cutoff date;
- provenance fields for source fingerprint / ledger coverage;
- current main / extended / total values;
- simple economic P&L and selected XIRR root;
- Trade Republic pocket totals;
- main-position values and allocation weights;
- forward benchmark checkpoints/observations required for incremental matched-flow history.

Position identities are scoped by pocket (`PEA:symbol` / `Compte-titres:symbol`) so the same security held in both accounts remains distinct.

History schema v2 is the current write format. Existing v1 IndexedDB records and exported backups are migrated in memory when read, marked with methodology `5.0-legacy`, and retained. The IndexedDB object-store layout is unchanged, so the migration is non-destructive.

The history store does **not** contain PDF/CSV bytes or the raw/normalized transaction history. Same-date saves deterministically replace the older save. Backup export/import uses an explicit versioned JSON schema; malformed or unsupported schemas are rejected rather than guessed.

The browser database is a working local history, not a guaranteed backup. The UI therefore provides explicit export, import and erase controls. Snapshot-to-snapshot raw value changes must remain clearly distinguished from flow-adjusted performance.

## Versioning rule for v5.2

Application/package version and financial-methodology version are separate concerns. v5.2 product work may ship with financial methodology `5.1` as long as portfolio scope, cash-flow mapping, XIRR, benchmark replay/checkpoints and snapshot-history conventions remain unchanged.
