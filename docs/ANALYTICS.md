# v5 analytical conventions

## Scope

Main portfolio = Compte-titres + PEA.

Cash is excluded from main performance. Therefore trades between securities and the excluded cash account are external cash flows relative to the main holdings-only scope.

## Transaction normalization

For each transaction:

`economic_cashflow_eur = amount + fee + tax`

Canonical main performance cash flows include:

- main-scope BUY / SELL rows;
- linked IPO_SUBSCRIPTION cash rows for main assets;
- main-scope DIVIDEND rows.

The sign from the Trade Republic export is preserved: investments are normally negative and withdrawals/distributions positive.

## Current main value

`main_value = Compte-Titres + PEA`

The values come from the official Net Worth snapshot rather than reconstructed market prices.

## Simple economic P&L

`simple_economic_pnl = current_main_value + sum(canonical_main_cashflows)`

This is an understandable realized + unrealized euro contribution. It is not factor attribution.

## XIRR / money-weighted return

For cash flows `CF_i` at dates `t_i`, solve `r > -1` such that:

`XNPV(r) = sum(CF_i / (1+r)^((t_i-t_0)/365.25)) = 0`

The current main value is appended as a positive terminal cash flow on the Net Worth snapshot date.

Solver policy:

1. aggregate same-date cash flows;
2. require at least one negative and one positive flow;
3. scan a broad rate domain for every sign-change bracket;
4. solve each bracket by bisection;
5. return PASS only for one unique converged root;
6. return WARN for multiple roots and select none;
7. return N/A if no defensible root exists.

## Benchmark policy

World and S&P 500 remain useful context, but benchmark reconstruction is no longer allowed to block the local portfolio analysis.

The future benchmark adapter should use only the minimum external market data necessary. Exact methodology will be frozen after the market-data feasibility test; it is not silently inherited from v4.

## Removed from the critical path

Daily reconstructed TTWROR, daily historical NAV backfill and realized-risk metrics based on that reconstructed series are not v5 acceptance criteria.
