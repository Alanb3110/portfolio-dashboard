import type { BenchmarkDefinition, BenchmarkPricePoint } from '../benchmark';

const EODHD_API_ORIGIN = 'https://eodhd.com';

interface EodhdRow {
  date?: unknown;
  adjusted_close?: unknown;
  adjustedClose?: unknown;
}

export interface EodhdDiagnosticResult {
  benchmarkId: BenchmarkDefinition['id'];
  symbol: string;
  rows: number;
  firstDate: string;
  lastDate: string;
  latestAdjustedClose: number;
  prices: BenchmarkPricePoint[];
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function buildEodhdEodUrl(
  benchmark: BenchmarkDefinition,
  token: string,
  from: string,
  to: string,
): string {
  if (!token.trim()) throw new Error('EODHD token is required.');
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error('Invalid EODHD diagnostic date range.');
  const symbol = `${benchmark.ticker}.${benchmark.venue === 'XETR' ? 'XETRA' : benchmark.venue}`;
  const url = new URL(`/api/eod/${encodeURIComponent(symbol)}`, EODHD_API_ORIGIN);
  url.searchParams.set('api_token', token.trim());
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  return url.toString();
}

export function parseEodhdRows(value: unknown): BenchmarkPricePoint[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'object' && value != null) {
      const object = value as Record<string, unknown>;
      const message = typeof object.message === 'string' ? object.message : null;
      const error = typeof object.error === 'string' ? object.error : null;
      throw new Error(message ?? error ?? 'Unexpected EODHD response shape.');
    }
    throw new Error('Unexpected EODHD response shape.');
  }

  const points: BenchmarkPricePoint[] = value.map((raw, index) => {
    if (typeof raw !== 'object' || raw == null) throw new Error(`Invalid EODHD row at index ${index}.`);
    const row = raw as EodhdRow;
    if (typeof row.date !== 'string' || !isIsoDate(row.date)) throw new Error(`Invalid EODHD date at index ${index}.`);
    const rawAdjusted = row.adjusted_close ?? row.adjustedClose;
    const adjustedClose = typeof rawAdjusted === 'number' ? rawAdjusted : Number(rawAdjusted);
    if (!Number.isFinite(adjustedClose) || adjustedClose <= 0) {
      throw new Error(`Invalid EODHD adjusted close on ${row.date}.`);
    }
    return { date: row.date, adjustedClose };
  });

  const dates = new Set<string>();
  for (const point of points) {
    if (dates.has(point.date)) throw new Error(`Duplicate EODHD date: ${point.date}.`);
    dates.add(point.date);
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

export async function runEodhdDiagnostic(
  benchmark: BenchmarkDefinition,
  token: string,
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EodhdDiagnosticResult> {
  const url = buildEodhdEodUrl(benchmark, token, from, to);
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
    throw new Error('EODHD request failed before a readable response was returned. This may indicate CORS or network blocking.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`EODHD returned a non-JSON response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const object = typeof payload === 'object' && payload != null ? payload as Record<string, unknown> : {};
    const detail = typeof object.message === 'string' ? object.message : typeof object.error === 'string' ? object.error : 'request rejected';
    throw new Error(`EODHD HTTP ${response.status}: ${detail}.`);
  }

  const prices = parseEodhdRows(payload);
  if (prices.length === 0) throw new Error('EODHD returned no price rows for this benchmark/date range.');
  const first = prices[0]!;
  const last = prices.at(-1)!;
  return {
    benchmarkId: benchmark.id,
    symbol: `${benchmark.ticker}.XETRA`,
    rows: prices.length,
    firstDate: first.date,
    lastDate: last.date,
    latestAdjustedClose: last.adjustedClose,
    prices,
  };
}
