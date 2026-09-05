import assert from 'node:assert/strict';
import worker from './src/index.js';

const cacheEntries = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      const cached = cacheEntries.get(request.url);
      return cached ? cached.clone() : undefined;
    },
    async put(request, response) {
      cacheEntries.set(request.url, response.clone());
    },
  },
};

let limiterCalls = 0;
let limiterSuccess = true;
const env = {
  ALLOWED_ORIGIN: 'https://alanb3110.github.io',
  EODHD_API_TOKEN: 'test-secret',
  MARKET_RATE_LIMITER: {
    async limit({ key }) {
      limiterCalls += 1;
      assert.equal(key, 'eodhd-upstream');
      return { success: limiterSuccess };
    },
  },
};
const pending = [];
const ctx = {
  waitUntil(promise) {
    pending.push(Promise.resolve(promise));
  },
};

const health = await worker.fetch(
  new Request('https://proxy.example/health', { headers: { Origin: env.ALLOWED_ORIGIN } }),
  env,
  ctx,
);
assert.equal(health.status, 200);
assert.equal(health.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
assert.deepEqual(await health.json(), {
  ok: true,
  service: 'portfolio-market-proxy',
  version: '2026-09-05-v5.1-readiness',
  providerConfigured: true,
  rateLimiterConfigured: true,
});

const missingProviderHealth = await worker.fetch(
  new Request('https://proxy.example/health', { headers: { Origin: env.ALLOWED_ORIGIN } }),
  { ...env, EODHD_API_TOKEN: undefined },
  ctx,
);
assert.equal(missingProviderHealth.status, 503);
assert.deepEqual(await missingProviderHealth.json(), {
  ok: false,
  service: 'portfolio-market-proxy',
  version: '2026-09-05-v5.1-readiness',
  providerConfigured: false,
  rateLimiterConfigured: true,
});

const missingLimiterHealth = await worker.fetch(
  new Request('https://proxy.example/health', { headers: { Origin: env.ALLOWED_ORIGIN } }),
  { ...env, MARKET_RATE_LIMITER: undefined },
  ctx,
);
assert.equal(missingLimiterHealth.status, 503);
const missingLimiterPayload = await missingLimiterHealth.json();
assert.equal(missingLimiterPayload.ok, false);
assert.equal(missingLimiterPayload.providerConfigured, true);
assert.equal(missingLimiterPayload.rateLimiterConfigured, false);

const blockedOrigin = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=msci-world&from=2026-08-01&to=2026-08-30', {
    headers: { Origin: 'https://evil.example' },
  }),
  env,
  ctx,
);
assert.equal(blockedOrigin.status, 403);

const missingOrigin = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=msci-world&from=2026-08-01&to=2026-08-30'),
  env,
  ctx,
);
assert.equal(missingOrigin.status, 403);

const unknownParam = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=msci-world&from=2026-08-01&to=2026-08-30&nonce=1', {
    headers: { Origin: env.ALLOWED_ORIGIN },
  }),
  env,
  ctx,
);
assert.equal(unknownParam.status, 400);

const duplicateParam = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=msci-world&from=2026-08-01&from=2026-08-02&to=2026-08-30', {
    headers: { Origin: env.ALLOWED_ORIGIN },
  }),
  env,
  ctx,
);
assert.equal(duplicateParam.status, 400);

let upstreamUrl = '';
let upstreamCalls = 0;
globalThis.fetch = async (input) => {
  upstreamCalls += 1;
  upstreamUrl = String(input);
  return new Response(JSON.stringify([
    { date: '2026-08-28', adjusted_close: 127.4 },
    { date: '2026-08-27', adjusted_close: 126.8 },
  ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const prices = await worker.fetch(
  new Request('https://proxy.example/prices?to=2026-08-30&benchmark=msci-world&from=2026-08-01', {
    headers: { Origin: env.ALLOWED_ORIGIN },
  }),
  env,
  ctx,
);
await Promise.all(pending.splice(0));
assert.equal(prices.status, 200);
assert.equal(upstreamCalls, 1);
assert.equal(limiterCalls, 1);
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

const cached = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=msci-world&from=2026-08-01&to=2026-08-30', {
    headers: { Origin: env.ALLOWED_ORIGIN },
  }),
  env,
  ctx,
);
assert.equal(cached.status, 200);
assert.equal(upstreamCalls, 1);
assert.equal(limiterCalls, 1);

limiterSuccess = false;
const rateLimited = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=sp500&from=2026-08-01&to=2026-08-30', {
    headers: { Origin: env.ALLOWED_ORIGIN },
  }),
  env,
  ctx,
);
assert.equal(rateLimited.status, 429);
assert.equal(upstreamCalls, 1);
assert.equal(limiterCalls, 2);

const tooWide = await worker.fetch(
  new Request('https://proxy.example/prices?benchmark=sp500&from=2025-01-01&to=2026-08-30', {
    headers: { Origin: env.ALLOWED_ORIGIN },
  }),
  env,
  ctx,
);
assert.equal(tooWide.status, 400);
assert.equal(limiterCalls, 2);

console.log('Cloudflare market proxy smoke tests passed.');
