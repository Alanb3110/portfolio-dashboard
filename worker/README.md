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

## Deployment layout

The canonical Worker implementation lives under `worker/`, but the repository intentionally contains **two equivalent Wrangler entry configurations**:

- `/wrangler.toml` for Cloudflare Workers Builds when its project root is the repository root;
- `/worker/wrangler.toml` for local/explicit deployments from the Worker directory.

The root configuration points to `worker/src/index.js`; the nested configuration points to `src/index.js`. `worker/check-config.mjs` is run by CI and fails if the two deployment configurations drift apart.

This duplication is intentional. On 2026-09-05, Workers Builds was observed deploying from the repository root while the Wrangler file existed only under `/worker`, which caused automatic Worker deployments to fail even though application CI and GitHub Pages remained healthy. Keeping both entry configurations makes the deployment robust to either Cloudflare project-root setting.

`worker/package.json` also pins the Wrangler version used when the Cloudflare project root is `/worker`.

## Health and readiness

`GET /health` validates the runtime bindings required by `/prices`, not only the deployed code version. A healthy response is HTTP 200 with:

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
- Both Wrangler configurations declare `EODHD_API_TOKEN` as a required secret. Wrangler deployment/version upload must fail instead of publishing a Worker without the provider credential.
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
2. Create/connect a Worker named `portfolio-market-proxy` to this repository.
3. Add a runtime secret named `EODHD_API_TOKEN` containing the EODHD key.
4. Production branch: `main`.
5. The Cloudflare project root may be `/` or `/worker`; both are supported by the repository. The repository-root configuration is the preferred default for the current Git integration.
6. Keep the deploy command as `npx wrangler deploy` unless there is a deliberate reason to override it.
7. Verify the Workers Build check is green and `/health` reports `ok: true`, `providerConfigured: true` and `rateLimiterConfigured: true` before accepting the deployment.

The committed rate-limit namespace is `5101`. If that namespace ID is already used by another rate-limit binding in the same Cloudflare account and should not share counters, change it to another positive integer in both Wrangler configurations before deployment.

### Wrangler alternative

From the repository root on a machine with Node.js:

```bash
npx wrangler login
cd worker
npx wrangler secret put EODHD_API_TOKEN
npm install
npm run deploy
```

The token is entered interactively by Wrangler and is stored as a Cloudflare secret, not in Git.

## Validation

Repository CI runs:

```bash
node --check worker/src/index.js
node worker/smoke-test.mjs
node worker/check-config.mjs
```

The smoke test verifies runtime readiness, origin restriction, strict query parameters, canonical cache reuse, rate limiting before upstream calls, benchmark allow-listing, date-range limits, provider response sanitization, and that the API token is not returned to the client. The config check verifies that both Wrangler entry configurations remain equivalent.
