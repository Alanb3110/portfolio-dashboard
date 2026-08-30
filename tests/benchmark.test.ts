import { describe, expect, it } from 'vitest';
import {
  BENCHMARKS,
  benchmarkRequestWindow,
  comparePortfolioToBenchmark,
  replayMatchedFlowBenchmark,
  type BenchmarkPricePoint,
} from '../src/benchmark';

const world = BENCHMARKS['msci-world'];

function prices(points: Array<[string, number]>): BenchmarkPricePoint[] {
  return points.map(([date, adjustedClose]) => ({ date, adjustedClose }));
}

describe('matched-flow benchmark engine', () => {
  it('replays contributions into synthetic benchmark units', () => {
    const replay = replayMatchedFlowBenchmark(
      world,
      [
        { date: '2025-01-02', amount: -1000 },
        { date: '2025-06-02', amount: -500 },
      ],
      '2026-01-02',
      prices([
        ['2025-01-02', 100],
        ['2025-06-02', 125],
        ['2026-01-02', 140],
      ]),
    );

    expect(replay.status).toBe('PASS');
    expect(replay.units).toBeCloseTo(14, 12);
    expect(replay.terminalValue).toBeCloseTo(1960, 12);
    expect(replay.xirr.status).toBe('PASS');
  });

  it('replays withdrawals by selling synthetic benchmark units', () => {
    const replay = replayMatchedFlowBenchmark(
      world,
      [
        { date: '2025-01-02', amount: -1000 },
        { date: '2025-06-02', amount: 220 },
      ],
      '2026-01-02',
      prices([
        ['2025-01-02', 100],
        ['2025-06-02', 110],
        ['2026-01-02', 120],
      ]),
    );

    expect(replay.status).toBe('PASS');
    expect(replay.units).toBeCloseTo(8, 12);
    expect(replay.terminalValue).toBeCloseTo(960, 12);
  });

  it('uses the latest available close on or before a weekend snapshot without look-ahead', () => {
    const replay = replayMatchedFlowBenchmark(
      world,
      [{ date: '2026-08-28', amount: -1000 }],
      '2026-08-30',
      prices([
        ['2026-08-28', 100],
        ['2026-08-31', 120],
      ]),
    );

    expect(replay.status).toBe('WARN');
    expect(replay.terminalPriceDate).toBe('2026-08-28');
    expect(replay.terminalValue).toBeCloseTo(1000, 12);
    expect(replay.ignoredFuturePricePoints).toBe(1);
    expect(replay.note).toMatch(/look-ahead/);
  });

  it('fails benchmark-only when an exact cash-flow date is missing', () => {
    const replay = replayMatchedFlowBenchmark(
      world,
      [{ date: '2025-01-02', amount: -1000 }],
      '2025-01-03',
      prices([['2025-01-03', 101]]),
    );

    expect(replay.status).toBe('N/A');
    expect(replay.terminalValue).toBeNull();
    expect(replay.missingFlowDates).toEqual(['2025-01-02']);
  });

  it('does not silently create a short benchmark when withdrawals exceed synthetic holdings', () => {
    const replay = replayMatchedFlowBenchmark(
      world,
      [
        { date: '2025-01-02', amount: -100 },
        { date: '2025-02-03', amount: 200 },
      ],
      '2025-02-03',
      prices([
        ['2025-01-02', 100],
        ['2025-02-03', 100],
      ]),
    );

    expect(replay.status).toBe('N/A');
    expect(replay.terminalValue).toBeNull();
    expect(replay.note).toMatch(/negative benchmark units/);
  });

  it('rejects ambiguous or financially invalid price series', () => {
    const duplicate = replayMatchedFlowBenchmark(
      world,
      [{ date: '2025-01-02', amount: -100 }],
      '2025-01-02',
      prices([
        ['2025-01-02', 100],
        ['2025-01-02', 101],
      ]),
    );
    expect(duplicate.status).toBe('N/A');
    expect(duplicate.note).toMatch(/Duplicate/);

    const nonPositive = replayMatchedFlowBenchmark(
      world,
      [{ date: '2025-01-02', amount: -100 }],
      '2025-01-02',
      prices([['2025-01-02', 0]]),
    );
    expect(nonPositive.status).toBe('N/A');
    expect(nonPositive.note).toMatch(/Invalid adjusted close/);
  });

  it('uses a coarse provider request window rather than transmitting all cash-flow dates', () => {
    const request = benchmarkRequestWindow(
      [
        { date: '2023-11-13', amount: -100 },
        { date: '2025-07-04', amount: -200 },
      ],
      '2026-08-30',
    );
    expect(request).toEqual({ from: '2023-01-01', to: '2026-08-30' });
  });

  it('compares actual terminal value and XIRR only after a valid replay', () => {
    const replay = replayMatchedFlowBenchmark(
      world,
      [{ date: '2025-01-02', amount: -1000 }],
      '2026-01-02',
      prices([
        ['2025-01-02', 100],
        ['2026-01-02', 110],
      ]),
    );
    const comparison = comparePortfolioToBenchmark(1200, 0.2, replay);
    expect(comparison.terminalValue).toBeCloseTo(1100, 12);
    expect(comparison.terminalValueGapEur).toBeCloseTo(100, 12);
    expect(comparison.terminalValueGapRatio).toBeCloseTo(1200 / 1100 - 1, 12);
    expect(comparison.benchmarkXirr).not.toBeNull();
    expect(comparison.xirrGap).not.toBeNull();
  });
});
