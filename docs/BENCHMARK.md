# Forward matched-flow benchmark methodology

## Objective

Compare the **main portfolio only** (Compte-titres + PEA) with synthetic MSCI World and S&P 500 alternatives without restoring the v4 daily-NAV/backfill complexity.

The v5 primary benchmark answers:

> Since the first saved v5 snapshot, what terminal value would the same starting capital and subsequent canonical main-portfolio cash flows have produced in the benchmark proxy?

It does **not** use actual MSCI World or S&P 500 holdings in the user's portfolio as the benchmark.

This methodology is frozen in v5.1 and remains the default for v5.2 unless a later PR explicitly declares a methodology-version change.

## Fixed benchmark proxies

| Benchmark | Proxy | ISIN | Xetra ticker | Currency |
|---|---|---|---|---|
| MSCI World | iShares Core MSCI World UCITS ETF | IE00B4L5Y983 | EUNL | EUR |
| S&P 500 | iShares Core S&P 500 UCITS ETF | IE00B5BMR087 | SXR8 | EUR |

Using EUR-traded accumulating UCITS proxies keeps the comparison aligned with the existing convention and avoids a separate FX leg in the benchmark engine.

## Primary method: forward baseline

Let the first saved v5 snapshot be date `T0`, with main-portfolio value `V0`. The synthetic benchmark starts at the **same value**:

`q0 = V0 / P(T0*)`

where `P(T0*)` is the latest benchmark close on or before the snapshot date. This allows a weekend/holiday Trade Republic snapshot without using future prices.

Only canonical cash flows **after** `T0` are replayed:

`q(t) = q(t-) - CF(t) / P(t)`

with the frozen holdings-scope sign convention:

- contribution / BUY cash flow: `CF < 0` → benchmark units increase;
- withdrawal / SELL / dividend cash flow: `CF > 0` → benchmark units decrease.

Terminal benchmark value at later snapshot `T`:

`Vbench(T) = q(T) * P(T*)`

where `T*` is the latest market close on or before the snapshot date.

Benchmark XIRR is calculated from:

- `-V0` on baseline date `T0`;
- the same canonical main cash flows after `T0`;
- `+Vbench(T)` on terminal snapshot date `T`;

using the same frozen 365-day convention as the portfolio XIRR.

For aligned periods shorter than 30 days, annualized XIRR is intentionally hidden in the UI. Terminal matched-flow benchmark values and euro/percentage gaps remain displayed.

## Checkpoint method

Forward benchmark state is persisted locally as a derived checkpoint associated with saved snapshots. A compatible checkpoint records enough benchmark state to continue replay causally from its `asOfDate` rather than fetching/replaying the entire baseline-to-current period on every refresh.

Normal benchmark operation therefore needs only the bounded market window after the latest compatible checkpoint. The checkpoint does not contain the user's raw transactions or source files.

Checkpoint compatibility remains tied to:

- benchmark identity;
- forward matched-flow method version;
- baseline snapshot date;
- baseline main value;
- checkpoint date not later than the evaluated snapshot.

A checkpoint is an optimization/state-continuation mechanism, not a change in benchmark methodology.

## Temporal rules

- A canonical flow occurring on a benchmark trading session requires an exact-date benchmark price for that flow date. Missing required flow-date prices make that replay unavailable; they are never silently forward-filled from the future.
- Baseline and terminal snapshots may use the latest close on or before their snapshot dates and expose the actual market-price cutoff.
- Future price points are ignored/rejected to prevent look-ahead bias.
- Duplicate dates, non-positive prices or invalid dates invalidate the benchmark series.
- A matched withdrawal that would create negative benchmark units is unavailable; the engine does not silently turn the synthetic benchmark into a short position.
- Transactions occurring on or before the first saved baseline snapshot are already represented in the baseline portfolio value and are not replayed a second time.

## Failure isolation

Benchmark status is independent from local portfolio status.

```text
PDF + CSV -> local portfolio analytics -> available if local validation passes
                      |
                      +-> benchmark price layer -> PASS / WARN / N/A independently
```

A provider outage, missing benchmark session, quota condition or malformed benchmark response must never block P&L, XIRR, allocation, snapshot history or total-net-worth views.

## Privacy boundary

The browser requests only one of the two fixed public benchmark IDs over a bounded date range. It must never transmit:

- holdings or quantities;
- NAV / P&L / XIRR;
- transaction rows or transaction amounts;
- imported files;
- source fingerprints;
- the individual list of cash-flow dates.

The Worker maps the public benchmark ID to the fixed Xetra symbol internally. Its response is reduced to date and adjusted close rows.

## Production market-data path

As validated for v5.1 on 2026-09-06, the production benchmark price path is:

`PWA -> restricted Cloudflare Worker -> EODHD`

The Worker:

- accepts only `msci-world` and `sp500`;
- accepts only bounded `from` / `to` date windows;
- maps internally to `EUNL.XETRA` and `SXR8.XETRA`;
- stores the EODHD API token as a Cloudflare secret;
- applies canonical cache keys and a shared upstream rate limiter;
- sanitizes provider output to date + adjusted close;
- exposes `/health` readiness for provider-secret and rate-limiter configuration;
- remains a public-market gateway, not a portfolio backend.

The live v5.1 validation confirmed usable MSCI World and S&P 500 synthetic benchmark values in the installed iPhone PWA. Therefore the earlier provider-feasibility screen is superseded for the current production configuration.

See `worker/README.md` for deployment/readiness details.

## Integrity expectations

For both EUNL/XETRA and SXR8/XETRA, production benchmark operation requires:

1. fixed unambiguous instrument identity;
2. coverage from the baseline/checkpoint request window through the evaluated snapshot cutoff;
3. exact required prices for canonical flow dates that are Xetra sessions;
4. no duplicate, future or non-positive values;
5. adjusted-close values from the configured provider;
6. strict causal handling of non-trading-day baseline/terminal dates;
7. benchmark failures isolated from local portfolio analytics.

## Change-control rule

Any future modification of fixed proxy identity, cash-flow replay semantics, baseline rules, checkpoint compatibility/semantics, price-date causality or benchmark XIRR convention is a methodology change and must not be introduced silently under methodology `5.1`.
