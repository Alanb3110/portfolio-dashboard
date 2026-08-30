# Lightweight benchmark methodology

## Objective

Compare the **main portfolio only** (Compte-titres + PEA) with synthetic MSCI World and S&P 500 alternatives without restoring the v4 daily-NAV/backfill complexity.

The benchmark answers:

> What terminal value would the same canonical main-portfolio cash-flow schedule have produced if it had been invested in the benchmark proxy instead?

It does **not** use actual MSCI World or S&P 500 holdings in the user's portfolio as the benchmark.

## Fixed benchmark proxies

| Benchmark | Proxy | ISIN | Xetra ticker | Currency |
|---|---|---|---|---|
| MSCI World | iShares Core MSCI World UCITS ETF | IE00B4L5Y983 | EUNL | EUR |
| S&P 500 | iShares Core S&P 500 UCITS ETF | IE00B5BMR087 | SXR8 | EUR |

Using EUR-traded accumulating UCITS proxies keeps the comparison aligned with the existing v4 convention and avoids a separate FX leg in the benchmark engine.

## Replay equations

For benchmark adjusted close \(P_t\), benchmark units \(q_t\), and canonical portfolio cash flow \(CF_t\):

\[
q_t=q_{t^-}-\frac{CF_t}{P_t}
\]

where the portfolio convention is:

- contribution / BUY cash flow: \(CF_t<0\) → benchmark units increase;
- withdrawal / SELL / dividend cash flow: \(CF_t>0\) → benchmark units decrease.

Terminal benchmark value at snapshot date \(T\):

\[
V_T^{bench}=q_T P_{T^*}
\]

where \(T^*\) is the latest market close **on or before** the snapshot date. This handles weekend/holiday Trade Republic snapshots without look-ahead.

Benchmark XIRR is then calculated from the same canonical cash flows plus \(+V_T^{bench}\) at \(T\), using the same frozen 365-day convention as the portfolio XIRR.

## Temporal rules

- Cash-flow dates require an **exact-date** benchmark price. Missing flow-date prices make that benchmark `N/A`; they are never silently forward/back-filled.
- The terminal snapshot may use the latest close on or before the snapshot date and is labelled with the actual market-price cutoff.
- Future price points are ignored and reported to prevent look-ahead bias.
- Duplicate dates, non-positive prices or invalid dates invalidate the benchmark series.
- A matched withdrawal that would create negative benchmark units is `N/A`; the engine does not silently turn the synthetic benchmark into a short position.

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

The initial request window is fixed at `2023-01-01` unless the ledger genuinely predates it. This intentionally over-fetches a small public series to avoid disclosing detailed transaction timing.

## Provider feasibility — 2026-08-30

This is a **preliminary documentation/API capability screen, not an empirical data-quality validation**. Exact EUNL/SXR8 availability, adjusted-price continuity and corporate-action correctness must still be tested before a provider is accepted.

| Provider | Current relevant offer | Historical depth | Xetra/global fit | Preliminary verdict |
|---|---|---:|---|---|
| EODHD | Free: 20 calls/day. EOD All World: USD 19.99/month | Free 1 year; paid 30+ years | EOD API documents global stocks/ETFs and adjusted close | **Candidate A** |
| Marketstack | Free: 100 requests/month. Basic: USD 9.99/month | Free 1 year; Basic 10 years | EOD plus splits/dividends; exact two-proxy coverage still unverified | **Candidate B** |
| Alpha Vantage | Standard limit 25 requests/day; adjusted daily endpoint is Premium | full adjusted history is Premium | International equities supported, but entitlement is less attractive here | Lower priority |
| Twelve Data | Grow: USD 79/month for individuals | global EOD under paid market access | Xetra (`XETR`) currently requires Grow | Reject on cost for this use case |

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
2. coverage from the earliest required date through the current cutoff;
3. 100% coverage of canonical cash-flow dates that are Xetra sessions;
4. no duplicate/future/non-positive values;
5. documented adjusted-close semantics;
6. spot-check agreement with an independent exchange/issuer reference on selected dates;
7. stable API terms and an acceptable personal-use cost.

Until those checks pass, **Evidence insufficient—cannot conclude** that any provider is production-ready for the benchmark layer.
