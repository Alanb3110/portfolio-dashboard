const BENCHMARKS = Object.freeze({
  'msci-world': 'EUNL.XETRA',
  sp500: 'SXR8.XETRA',
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 370;
const CACHE_SECONDS = 6 * 60 * 60;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN || 'https://alanb3110.github.io';
  if (origin === allowed) {
    return {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
  }
  return { Vary: 'Origin' };
}

function parseDate(value) {
  if (!value || !ISO_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
}

function validateWindow(fromRaw, toRaw) {
  const from = parseDate(fromRaw);
  const to = parseDate(toRaw);
  if (!from || !to) return { ok: false, error: 'from and to must be valid ISO dates.' };
  if (from > to) return { ok: false, error: 'from must be on or before to.' };
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (days > MAX_RANGE_DAYS) return { ok: false, error: `Date range exceeds ${MAX_RANGE_DAYS} days.` };
  return { ok: true, from: fromRaw, to: toRaw };
}

function sanitizeRows(payload) {
  if (!Array.isArray(payload)) throw new Error('Provider payload is not an array.');
  const seen = new Set();
  const rows = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') throw new Error('Provider row is invalid.');
    const date = typeof item.date === 'string' ? item.date : '';
    const adjustedClose = Number(item.adjusted_close);
    if (!parseDate(date)) throw new Error('Provider returned an invalid date.');
    if (!Number.isFinite(adjustedClose) || adjustedClose <= 0) {
      throw new Error('Provider returned an invalid adjusted close.');
    }
    if (seen.has(date)) throw new Error('Provider returned a duplicate date.');
    seen.add(date);
    rows.push({ date, adjustedClose });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function fetchBenchmark(benchmarkId, from, to, env) {
  const symbol = BENCHMARKS[benchmarkId];
  if (!symbol) return { response: json({ error: 'Unknown benchmark.' }, 404), cacheable: false };
  if (!env.EODHD_API_TOKEN) return { response: json({ error: 'Market provider is not configured.' }, 503), cacheable: false };

  const providerUrl = new URL(`https://eodhd.com/api/eod/${symbol}`);
  providerUrl.searchParams.set('api_token', env.EODHD_API_TOKEN);
  providerUrl.searchParams.set('fmt', 'json');
  providerUrl.searchParams.set('period', 'd');
  providerUrl.searchParams.set('order', 'a');
  providerUrl.searchParams.set('from', from);
  providerUrl.searchParams.set('to', to);

  let upstream;
  try {
    upstream = await fetch(providerUrl.toString(), {
      headers: { Accept: 'application/json' },
    });
  } catch {
    return { response: json({ error: 'Market provider request failed.' }, 502), cacheable: false };
  }

  if (!upstream.ok) {
    return {
      response: json({ error: `Market provider returned HTTP ${upstream.status}.` }, 502),
      cacheable: false,
    };
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return { response: json({ error: 'Market provider returned unreadable JSON.' }, 502), cacheable: false };
  }

  let rows;
  try {
    rows = sanitizeRows(payload);
  } catch {
    return { response: json({ error: 'Market provider returned invalid price data.' }, 502), cacheable: false };
  }

  return {
    response: json(
      {
        benchmark: benchmarkId,
        symbol,
        currency: 'EUR',
        venue: 'XETRA',
        from,
        to,
        rows,
      },
      200,
      { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    ),
    cacheable: true,
  };
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGIN || 'https://alanb3110.github.io';

    if (origin && origin !== allowed) return json({ error: 'Origin not allowed.' }, 403, cors);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, cors);

    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (url.pathname !== '/prices') return json({ error: 'Not found.' }, 404, cors);

    const benchmarkId = url.searchParams.get('benchmark') || '';
    if (!(benchmarkId in BENCHMARKS)) return json({ error: 'Unknown benchmark.' }, 404, cors);

    const window = validateWindow(url.searchParams.get('from'), url.searchParams.get('to'));
    if (!window.ok) return json({ error: window.error }, 400, cors);

    const cache = caches.default;
    const cacheKeyUrl = new URL(request.url);
    cacheKeyUrl.searchParams.sort();
    const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(cached.body, { status: cached.status, headers });
    }

    const result = await fetchBenchmark(benchmarkId, window.from, window.to, env);
    const headers = new Headers(result.response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    const response = new Response(result.response.body, { status: result.response.status, headers });

    if (result.cacheable) {
      const cacheCopy = response.clone();
      ctx.waitUntil(cache.put(cacheKey, cacheCopy));
    }
    return response;
  },
};
