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

## Privacy and security

- `EODHD_API_TOKEN` is a Cloudflare secret and must never be committed.
- Production CORS is limited to `https://alanb3110.github.io`.
- Only `GET` and CORS `OPTIONS` are accepted.
- Date ranges are capped at 370 days, consistent with the forward-v5 benchmark design and the free EODHD history window.
- Upstream responses are reduced to `date` + `adjustedClose` before returning to the browser.
- Successful market responses are cached for 6 hours to preserve the EODHD request quota.

## One-time Cloudflare setup

The application can continue to be hosted on GitHub Pages. Only this small Worker needs Cloudflare.

1. Create or sign in to a Cloudflare account.
2. Create a Worker named `portfolio-market-proxy` (Workers & Pages -> Create -> Worker), or deploy this directory with Wrangler.
3. Add a secret named `EODHD_API_TOKEN` containing the EODHD key.
4. Deploy the Worker and copy its `https://...workers.dev` URL.
5. Configure the PWA market adapter with that URL. Do not put the EODHD token in the PWA.

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

The smoke test verifies origin restriction, benchmark allow-listing, date-range limits, provider response sanitization, and that the API token is not returned to the client.
