import { describe, expect, it, vi } from 'vitest';
import { BENCHMARKS } from '../src/benchmark';
import {
  buildMarketProxyUrl,
  fetchMarketProxyPrices,
  parseMarketProxyPayload,
} from '../src/providers/market-proxy';

describe('market proxy adapter', () => {
  it('builds an allow-listed benchmark URL without portfolio data', () => {
    const url = new URL(buildMarketProxyUrl(BENCHMARKS['msci-world'], '2026-08-01', '2026-08-30'));
    expect(url.hostname).toBe('portfolio-market-proxy.alan-boulard.workers.dev');
    expect(url.pathname).toBe('/prices');
    expect(url.searchParams.get('benchmark')).toBe('msci-world');
    expect(url.searchParams.get('from')).toBe('2026-08-01');
    expect(url.searchParams.get('to')).toBe('2026-08-30');
    expect([...url.searchParams.keys()].sort()).toEqual(['benchmark', 'from', 'to']);
  });

  it('accepts the sanitized Worker payload', () => {
    const prices = parseMarketProxyPayload(BENCHMARKS['msci-world'], {
      benchmark: 'msci-world',
      symbol: 'EUNL.XETRA',
      currency: 'EUR',
      venue: 'XETRA',
      from: '2026-08-01',
      to: '2026-08-30',
      rows: [
        { date: '2026-08-04', adjustedClose: 127.79 },
        { date: '2026-08-03', adjustedClose: 126.175 },
      ],
    });
    expect(prices).toEqual([
      { date: '2026-08-03', adjustedClose: 126.175 },
      { date: '2026-08-04', adjustedClose: 127.79 },
    ]);
  });

  it('rejects a payload whose benchmark identity does not match the request', () => {
    expect(() => parseMarketProxyPayload(BENCHMARKS['msci-world'], {
      benchmark: 'sp500',
      symbol: 'SXR8.XETRA',
      currency: 'EUR',
      venue: 'XETRA',
      rows: [{ date: '2026-08-03', adjustedClose: 600 }],
    })).toThrow(/wrong benchmark identity/i);
  });

  it('fetches rows without credentials or referrer data', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      benchmark: 'sp500',
      symbol: 'SXR8.XETRA',
      currency: 'EUR',
      venue: 'XETRA',
      from: '2026-08-01',
      to: '2026-08-30',
      rows: [{ date: '2026-08-03', adjustedClose: 610.25 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    const prices = await fetchMarketProxyPrices(
      BENCHMARKS.sp500,
      '2026-08-01',
      '2026-08-30',
      fetchImpl,
    );
    expect(prices).toEqual([{ date: '2026-08-03', adjustedClose: 610.25 }]);
  });
});
