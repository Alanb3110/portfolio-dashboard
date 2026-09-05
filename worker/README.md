# Portfolio market proxy

This Cloudflare Worker is intentionally **not** a portfolio backend. It is a narrow gateway for two public benchmark price series only.

## Accepted requests

```text
GET /health
GET /prices?benchmark=msci-world&from=YYYY-MM-DD&to=YYYY-MM-DD
GET /prices?benchmark=sp500&from=YYYY-MM-DD&to=YYYY-MM-DD
```

The Worker maps those IDs internally to:

- `msci-world` -> `EUNL.XETRA` (IE00B4L5Y983)
- `sp500` -> `SXR8.XETRA` (IE00B5BMR087)

It does not accept arbitrary symbols, holdings, quantities, transaction rows, NAV, P&L, XIRR, PDF/CSV files, or portfolio identifiers.

## Health and readiness

`GET /health` now validates the runtime bindings required by `/prices`, not only the deployed code version. A healthy response is HTTP 200 with:

```json
{
  "ok": true,
  "service": "portfolio-market-proxy",
  "version": "2026-09-05-v5.1-readiness",
  "providerConfigured": true,
  "rateLimiterConfigured": true
}
```

If the EODHD secret or rate-limiter binding is missing, `/health` returns HTTP 503 and identifies only which binding class is absent. It never exposes the secret value.

## Privacy, abuse resistance and quota protection

- `EODHD_API_TOKEN` is a Cloudflare secret and must never be committed.
- `worker/wrangler.toml` declares `EODHD_API_TOKEN` as a required secret. Wrangler deployment/version upload must fail instead of publishing a Worker without the provider credential.
- `/prices` requires the configured PWA `Origin`; requests without that origin are rejected. This is defense in depth, not authentication, because non-browser clients can spoof `Origin`.
- Only the exact query parameters `benchmark`, `from` and `to` are accepted, each exactly once. Unknown or duplicate parameters are rejected instead of becoming cache-key variants.
- Cache keys are rebuilt canonically from the validated benchmark/date tuple, independent of incoming query-string order.
- Successful market responses are cached for 6 hours.
- Only a cache miss can consume the `MARKET_RATE_LIMITER` binding. The production binding allows 4 upstream attempts per 60 seconds for the shared `eodhd-upstream` key.
- The limiter is deliberately shared across both benchmarks so concurrent World/S&P refreshes count against one upstream burst budget.
- Cloudflare rate limiting is local to a Cloudflare location and intentionally permissive/eventually consistent. It reduces burst abuse but is **not** an exact daily-accounting mechanism for the EODHD quota.
- Date ranges are capped at 370 days; forward benchmark checkpoints keep normal requests bounded to the latest local checkpoint.
- Upstream responses are reduced to `date` + `adjustedClose` before returning to the browser.

## One-time Cloudflare setup

The application can continue to be hosted on GitHub Pages. Only this small Worker needs Cloudflare.

1. Create or sign in to a Cloudflare account.
2. Create a Worker named `portfolio-market-proxy`, or deploy this directory with Wrangler.
3. Add a secret named `EODHD_API_TOKEN` containing the EODHD key.
4. Deploy using `worker/wrangler.toml`; it declares both the required secret name and the `MARKET_RATE_LIMITER` binding.
5. Verify `/health` reports `ok: true`, `providerConfigured: true` and `rateLimiterConfigured: true` before accepting the deployment.
6. Copy the deployed `https://...workers.dev` URL into the reviewed PWA market adapter. Do not put the EODHD token in the PWA.

The committed rate-limit namespace is `5101`. If that namespace ID is already used by another rate-limit binding in the same Cloudflare account and should not share counters, change it to another positive integer before deployment.

### Wrangler alternative

From the repository root on a machine with Node.js:

```bash
npx wrangler login
cd worker
npx wrangler secret put EODHD_API_TOKEN
npx wrangler deploy
```

The token is entered interactively by Wrangler and is stored as a Cloudflare secret, not in Git.

## Validation

Repository CI runs:

```bash
node --check worker/src/index.js
node worker/smoke-test.mjs
```

The smoke test verifies runtime readiness, origin restriction, strict query parameters, canonical cache reuse, rate limiting before upstream calls, benchmark allow-listing, date-range limits, provider response sanitization, and that the API token is not returned to the client.
