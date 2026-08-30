import assert from 'node:assert/strict';
import worker from './src/index.js';

globalThis.caches = {
  default: {
    async match() { return undefined; },
    async put() {},
  },
};

const env = {
  ALLOWED_ORIGIN: 'https://alanb3110.github.io',
  EODHD_API_TOKEN: 'test-secret',
};
const ctx = { waitUntil() {} };

const health = await worker.fetch(
  new Request('https://proxy.example/health', { headers: { Origin: env.ALLOWED_ORIGIN } }),
  env,
  ctx,
);
assert.equal(health.status, 200);
assert.equal(health.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
assert.deepEqual(await health.json(), { ok: true });

const blocked = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=msci-world&from=2026-08-01&to=2026-08-30', {
    headers: { Origin: 'https://evil.example' },
  }),
  env,
  ctx,
);
assert.equal(blocked.status, 403);

let upstreamUrl = '';
globalThis.fetch = async (input) => {
  upstreamUrl = String(input);
  return new Response(JSON.stringify([
    { date: '2026-08-28', adjusted_close: 127.4 },
    { date: '2026-08-27', adjusted_close: 126.8 },
  ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const prices = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=msci-world&from=2026-08-01&to=2026-08-30', {
    headers: { Origin: env.ALLOWED_ORIGIN },
  }),
  env,
  ctx,
);
assert.equal(prices.status, 200);
assert.match(upstreamUrl, /EUNL\.XETRA/);
assert.match(upstreamUrl, /api_token=test-secret/);
const payload = await prices.json();
assert.equal(payload.benchmark, 'msci-world');
assert.equal(payload.symbol, 'EUNL.XETRA');
assert.deepEqual(payload.rows, [
  { date: '2026-08-27', adjustedClose: 126.8 },
  { date: '2026-08-28', adjustedClose: 127.4 },
]);
assert.equal(JSON.stringify(payload).includes('test-secret'), false);

const tooWide = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=sp500&from=2025-01-01&to=2026-08-30', {
    headers: { Origin: env.ALLOWED_ORIGIN },
  }),
  env,
  ctx,
);
assert.equal(tooWide.status, 400);

console.log('Cloudflare market proxy smoke tests passed.');
