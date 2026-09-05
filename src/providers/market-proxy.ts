import type { BenchmarkDefinition, BenchmarkPricePoint } from '../benchmark';

export const MARKET_PROXY_ORIGIN = 'https://portfolio-market-proxy.alan-boulard.workers.dev';

interface ProxyPayload {
  benchmark?: unknown;
  symbol?: unknown;
  currency?: unknown;
  venue?: unknown;
  from?: unknown;
  to?: unknown;
  rows?: unknown;
  error?: unknown;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function buildMarketProxyUrl(benchmark: BenchmarkDefinition, from: string, to: string): string {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error('Invalid benchmark proxy date range.');
  const url = new URL('/prices', MARKET_PROXY_ORIGIN);
  url.searchParams.set('benchmark', benchmark.id);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  return url.toString();
}

export function parseMarketProxyPayload(
  benchmark: BenchmarkDefinition,
  value: unknown,
): BenchmarkPricePoint[] {
  if (typeof value !== 'object' || value == null) throw new Error('Benchmark proxy returned an invalid payload.');
  const payload = value as ProxyPayload;
  if (typeof payload.error === 'string' && payload.error.length > 0) throw new Error(payload.error);
  if (payload.benchmark !== benchmark.id) throw new Error('Benchmark proxy returned the wrong benchmark identity.');
  if (payload.currency !== 'EUR') throw new Error('Benchmark proxy returned an unexpected currency.');
  if (payload.venue !== 'XETRA') throw new Error('Benchmark proxy returned an unexpected venue.');
  const expectedSymbol = `${benchmark.ticker}.XETRA`;
  if (payload.symbol !== expectedSymbol) throw new Error('Benchmark proxy returned the wrong symbol.');
  if (!Array.isArray(payload.rows)) throw new Error('Benchmark proxy returned invalid rows.');

  const dates = new Set<string>();
  const rows = payload.rows.map((raw, index): BenchmarkPricePoint => {
    if (typeof raw !== 'object' || raw == null) throw new Error(`Invalid benchmark proxy row at index ${index}.`);
    const object = raw as Record<string, unknown>;
    if (typeof object.date !== 'string' || !isIsoDate(object.date)) {
      throw new Error(`Invalid benchmark proxy date at index ${index}.`);
    }
    const adjustedClose = typeof object.adjustedClose === 'number'
      ? object.adjustedClose
      : Number(object.adjustedClose);
    if (!Number.isFinite(adjustedClose) || adjustedClose <= 0) {
      throw new Error(`Invalid benchmark proxy adjusted close on ${object.date}.`);
    }
    if (dates.has(object.date)) throw new Error(`Duplicate benchmark proxy date: ${object.date}.`);
    dates.add(object.date);
    return { date: object.date, adjustedClose };
  });

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchMarketProxyPrices(
  benchmark: BenchmarkDefinition,
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BenchmarkPricePoint[]> {
  const url = buildMarketProxyUrl(benchmark, from, to);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new Error('Benchmark proxy request failed before a readable response was returned.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Benchmark proxy returned non-JSON data (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const object = typeof payload === 'object' && payload != null ? payload as Record<string, unknown> : {};
    const detail = typeof object.error === 'string' ? object.error : 'request rejected';
    throw new Error(`Benchmark proxy HTTP ${response.status}: ${detail}.`);
  }

  const prices = parseMarketProxyPayload(benchmark, payload);
  if (prices.length === 0) throw new Error('Benchmark proxy returned no price rows for this period.');
  return prices;
}
