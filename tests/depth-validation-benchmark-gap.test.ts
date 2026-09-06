import { describe, expect, it } from 'vitest';
import { BENCHMARKS, type BenchmarkPricePoint } from '../src/benchmark';
import { replayBenchmarkFromBaseline } from '../src/benchmark-forward';

function prices(points: Array<[string, number]>): BenchmarkPricePoint[] {
  return points.map(([date, adjustedClose]) => ({ date, adjustedClose }));
}

describe('v5.2 depth validation — benchmark data gaps', () => {
  it('refuses a matched flow when its required trading-session price is missing', () => {
    // Synthetic session calendar for this fixture:
    // 2026-08-07, 2026-08-10 and 2026-08-11 are consecutive benchmark sessions.
    // The 2026-08-10 close is deliberately omitted to model a provider/data gap,
    // not a weekend or holiday. Frozen methodology requires the exact session price
    // for a flow on a benchmark trading session; the engine must not silently execute
    // that flow at 2026-08-11.
    const result = replayBenchmarkFromBaseline(
      BENCHMARKS['msci-world'],
      { snapshotDate: '2026-08-03', mainValue: 1000 },
      [{ date: '2026-08-10', amount: -200 }],
      '2026-08-31',
      prices([
        ['2026-08-03', 100],
        ['2026-08-07', 105],
        // 2026-08-10 deliberately missing.
        ['2026-08-11', 111],
        ['2026-08-31', 120],
      ]),
    );

    expect(result.status).toBe('N/A');
    expect(result.terminalValue).toBeNull();
    expect(result.missingFlowDates).toEqual(['2026-08-10']);
    expect(result.note).toMatch(/missing|no causal benchmark close|unavailable/i);
  });
});
