import { describe, expect, it, vi } from 'vitest';
import { BENCHMARKS } from '../src/benchmark';
import { buildEodhdEodUrl, parseEodhdRows, runEodhdDiagnostic } from '../src/providers/eodhd';

const world = BENCHMARKS['msci-world'];

describe('EODHD browser diagnostic', () => {
  it('builds only the fixed public benchmark request with the token in the provider URL', () => {
    const url = new URL(buildEodhdEodUrl(world, 'secret-token', '2026-08-01', '2026-08-30'));
    expect(url.origin).toBe('https://eodhd.com');
    expect(url.pathname).toBe('/api/eod/EUNL.XETRA');
    expect(url.searchParams.get('api_token')).toBe('secret-token');
    expect(url.searchParams.get('from')).toBe('2026-08-01');
    expect(url.searchParams.get('to')).toBe('2026-08-30');
  });

  it('parses and sorts adjusted closes while rejecting duplicates', () => {
    const rows = parseEodhdRows([
      { date: '2026-08-28', adjusted_close: 127.4 },
      { date: '2026-08-27', adjusted_close: '126.8' },
    ]);
    expect(rows).toEqual([
      { date: '2026-08-27', adjustedClose: 126.8 },
      { date: '2026-08-28', adjustedClose: 127.4 },
    ]);
    expect(() => parseEodhdRows([
      { date: '2026-08-28', adjusted_close: 127.4 },
      { date: '2026-08-28', adjusted_close: 127.5 },
    ])).toThrow(/Duplicate/);
  });

  it('surfaces provider error payloads without exposing the token in the error', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'Invalid API token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));
    try {
      await runEodhdDiagnostic(world, 'super-secret', '2026-08-01', '2026-08-30', fetchMock as typeof fetch);
      throw new Error('Expected diagnostic rejection.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/HTTP 401: Invalid API token/);
      expect(message).not.toContain('super-secret');
    }
  });

  it('returns compact quality metadata for a successful response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { date: '2026-08-27', adjusted_close: 126.8 },
      { date: '2026-08-28', adjusted_close: 127.4 },
    ]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const result = await runEodhdDiagnostic(world, 'token', '2026-08-01', '2026-08-30', fetchMock as typeof fetch);
    expect(result.symbol).toBe('EUNL.XETRA');
    expect(result.rows).toBe(2);
    expect(result.firstDate).toBe('2026-08-27');
    expect(result.lastDate).toBe('2026-08-28');
    expect(result.latestAdjustedClose).toBe(127.4);
  });
});
