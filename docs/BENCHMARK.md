# Lightweight benchmark methodology

## Objective

Compare the **main portfolio only** (Compte-titres + PEA) with synthetic MSCI World and S&P 500 alternatives without restoring the v4 daily-NAV/backfill complexity.

The v5 primary benchmark answers:

> Since the first saved v5 snapshot, what terminal value would the same starting capital and subsequent canonical main-portfolio cash flows have produced in the benchmark proxy?

It does **not** use actual MSCI World or S&P 500 holdings in the user's portfolio as the benchmark.

## Fixed benchmark proxies

| Benchmark | Proxy | ISIN | Xetra ticker | Currency |
|---|---|---|---|---|
| MSCI World | iShares Core MSCI World UCITS ETF | IE00B4L5Y983 | EUNL | EUR |
| S&P 500 | iShares Core S&P 500 UCITS ETF | IE00B5BMR087 | SXR8 | EUR |

Using EUR-traded accumulating UCITS proxies keeps the comparison aligned with the existing v4 convention and avoids a separate FX leg in the benchmark engine.

## Primary v5 method: forward baseline

Let the first saved v5 snapshot be date \(T_0\), with main-portfolio value \(V_{T_0}\). The synthetic benchmark starts at the **same value**:

\[
q_{T_0}=\frac{V_{T_0}}{P_{T_0^*}}
\]

where \(P_{T_0^*}\) is the latest benchmark close on or before the snapshot date. This allows a weekend/holiday Trade Republic snapshot without using future prices.

Only canonical cash flows **after** \(T_0\) are replayed:

\[
q_t=q_{t^-}-\frac{CF_t}{P_t}
\]

with the existing holdings-scope sign convention:

- contribution / BUY cash flow: \(CF_t<0\) → benchmark units increase;
- withdrawal / SELL / dividend cash flow: \(CF_t>0\) → benchmark units decrease.

Terminal benchmark value at later snapshot \(T\):

\[
V_T^{bench}=q_T P_{T^*}
\]

where \(T^*\) is the latest market close on or before the snapshot date.

Benchmark XIRR is calculated from:

- \(-V_{T_0}\) on baseline date \(T_0\);
- the same canonical main cash flows after \(T_0\);
- \(+V_T^{bench}\) on terminal snapshot date \(T\);

using the same frozen 365-day convention as the portfolio XIRR.

### Why this is the v5 default

This preserves a financially fair matched-flow comparison while eliminating the need to reconstruct benchmark history back to 2023. The market-data layer only needs prices from shortly before the first v5 snapshot onward. With local caching, a free provider offering one year of history can therefore be sufficient for normal ongoing use.

The old full-history matched-flow engine remains implemented as an analytical option, but it is **not required for the v5 dashboard**.

## Temporal rules

- Future cash-flow dates after the baseline require an **exact-date** benchmark price. Missing flow-date prices make that benchmark `N/A`; they are never silently forward/back-filled.
- Baseline and terminal snapshots may use the latest close on or before their snapshot dates and display the actual market-price cutoff.
- Future price points are ignored and reported to prevent look-ahead bias.
- Duplicate dates, non-positive prices or invalid dates invalidate the benchmark series.
- A matched withdrawal that would create negative benchmark units is `N/A`; the engine does not silently turn the synthetic benchmark into a short position.
- Transactions occurring on or before the first v5 snapshot are already represented in the baseline portfolio value and are therefore not replayed a second time.

## Failure isolation

Benchmark status is independent from local portfolio status.

```text
PDF + CSV -> local portfolio analytics -> always available if local validation passes
                      |
                      +-> benchmark price layer -> PASS / WARN / N/A independently
```

A provider outage, missing benchmark session or malformed benchmark response must never block P&L, XIRR, allocation, snapshot history or total-net-worth views.

## Privacy boundary

The future network adapter should request only the two fixed public benchmark series over a coarse date range. It must never transmit:

- holdings or quantities;
- NAV / P&L / XIRR;
- transaction rows or transaction amounts;
- imported files;
- the individual list of cash-flow dates.

For the forward baseline, the provider request begins seven calendar days before the baseline snapshot and ends at the current snapshot. This small over-fetch handles ordinary weekends/market holidays without disclosing transaction timing.

## Provider feasibility — 2026-08-30

This is a **preliminary documentation/API capability screen, not an empirical data-quality validation**. Exact EUNL/SXR8 availability, adjusted-price continuity and corporate-action correctness must still be tested before a provider is accepted.

| Provider | Current relevant offer | Historical depth | Xetra/global fit | Preliminary verdict |
|---|---|---:|---|---|
| EODHD | Free: 20 calls/day. EOD All World: USD 19.99/month | Free 1 year; paid 30+ years | EOD API documents global stocks/ETFs and adjusted close | **Candidate A** |
| Marketstack | Free: 100 requests/month. Basic: USD 9.99/month | Free 1 year; Basic 10 years | EOD plus splits/dividends; exact two-proxy coverage still unverified | **Candidate B** |
| Alpha Vantage | Standard limit 25 requests/day; adjusted daily endpoint is Premium | full adjusted history is Premium | International equities supported, but entitlement is less attractive here | Lower priority |
| Twelve Data | Grow: USD 79/month for individuals | global EOD under paid market access | Xetra (`XETR`) currently requires Grow | Reject on cost for this use case |

The forward-baseline method materially changes the economics of this choice: **we no longer need to buy a 2023→present backfill**. A free one-year history is adequate in principle if the two Xetra proxies are actually covered and the app keeps its public benchmark cache up to date.

Official references checked on 2026-08-30:

- EODHD pricing: https://eodhd.com/pricing
- EODHD EOD historical API: https://eodhd.com/financial-apis/api-for-historical-data-and-volumes
- Marketstack pricing: https://marketstack.com/pricing
- Alpha Vantage documentation: https://www.alphavantage.co/documentation/
- Alpha Vantage premium/limits: https://www.alphavantage.co/premium/
- Twelve Data March 2026 pricing update: https://twelvedata.com/news/march-2026-updates
- Twelve Data Xetra exchange access: https://twelvedata.com/exchanges/XETR

## Acceptance gate before network integration

For both EUNL/XETR and SXR8/XETR, the selected provider must demonstrate:

1. unambiguous instrument identity (ISIN/ticker/venue/currency);
2. coverage from the v5 baseline through the current cutoff;
3. 100% coverage of post-baseline canonical cash-flow dates that are Xetra sessions;
4. no duplicate/future/non-positive values;
5. documented adjusted-close semantics;
6. spot-check agreement with an independent exchange/issuer reference on selected dates;
7. stable API terms and an acceptable personal-use cost.

Until those checks pass, **Evidence insufficient—cannot conclude** that any provider is production-ready for the benchmark layer.
