import { describe, expect, it } from 'vitest';
import { BENCHMARKS, type BenchmarkPricePoint } from '../src/benchmark';
import { replayBenchmarkFromBaseline } from '../src/benchmark-forward';

function prices(points: Array<[string, number]>): BenchmarkPricePoint[] {
  return points.map(([date, adjustedClose]) => ({ date, adjustedClose }));
}

describe('benchmark flow-date gap handling', () => {
  it('refuses a weekday matched flow when its exact benchmark close is missing', () => {
    const result = replayBenchmarkFromBaseline(
      BENCHMARKS['msci-world'],
      { snapshotDate: '2026-08-03', mainValue: 1000 },
      [{ date: '2026-08-10', amount: -200 }],
      '2026-08-31',
      prices([
        ['2026-08-03', 100],
        ['2026-08-07', 105],
        ['2026-08-11', 111],
        ['2026-08-31', 120],
      ]),
    );

    expect(result.status).toBe('N/A');
    expect(result.terminalValue).toBeNull();
    expect(result.missingFlowDates).toEqual(['2026-08-10']);
  });

  it('keeps the existing causal next-close rule for weekend flows', () => {
    const result = replayBenchmarkFromBaseline(
      BENCHMARKS['msci-world'],
      { snapshotDate: '2026-08-03', mainValue: 1000 },
      [{ date: '2026-08-08', amount: -200 }],
      '2026-08-31',
      prices([
        ['2026-08-03', 100],
        ['2026-08-07', 105],
        ['2026-08-10', 110],
        ['2026-08-31', 120],
      ]),
    );

    expect(result.status).toBe('PASS');
    expect(result.units).toBeCloseTo(10 + 200 / 110, 12);
    expect(result.note).toMatch(/first available close after the flow date/i);
  });
});
