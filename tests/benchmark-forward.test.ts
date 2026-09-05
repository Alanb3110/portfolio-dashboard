import { describe, expect, it } from 'vitest';
import { BENCHMARKS, type BenchmarkPricePoint } from '../src/benchmark';
import {
  checkpointBenchmarkRequestWindow,
  checkpointFromReplay,
  forwardBenchmarkRequestWindow,
  replayBenchmarkFromBaseline,
  replayBenchmarkFromCheckpoint,
} from '../src/benchmark-forward';

const world = BENCHMARKS['msci-world'];

function prices(points: Array<[string, number]>): BenchmarkPricePoint[] {
  return points.map(([date, adjustedClose]) => ({ date, adjustedClose }));
}

describe('forward benchmark baseline', () => {
  it('starts benchmark value exactly from the first v5 snapshot and replays only later flows', () => {
    const replay = replayBenchmarkFromBaseline(
      world,
      { snapshotDate: '2026-08-03', mainValue: 1000 },
      [
        { date: '2025-01-02', amount: -5000 },
        { date: '2026-08-10', amount: -200 },
      ],
      '2026-08-31',
      prices([
        ['2026-08-03', 100],
        ['2026-08-10', 110],
        ['2026-08-31', 120],
      ]),
    );

    expect(replay.status).toBe('PASS');
    expect(replay.units).toBeCloseTo(10 + 200 / 110, 12);
    expect(replay.terminalValue).toBeCloseTo((10 + 200 / 110) * 120, 12);
    expect(replay.note).toMatch(/Forward benchmark baseline/);
  });

  it('does not replay transactions occurring on or before the baseline snapshot', () => {
    const replay = replayBenchmarkFromBaseline(
      world,
      { snapshotDate: '2026-08-03', mainValue: 1000 },
      [
        { date: '2026-08-03', amount: -500 },
        { date: '2026-08-04', amount: -100 },
      ],
      '2026-08-04',
      prices([
        ['2026-08-03', 100],
        ['2026-08-04', 100],
      ]),
    );
    expect(replay.units).toBeCloseTo(11, 12);
    expect(replay.terminalValue).toBeCloseTo(1100, 12);
  });

  it('handles weekend baseline and terminal snapshots with prior closes but no look-ahead', () => {
    const replay = replayBenchmarkFromBaseline(
      world,
      { snapshotDate: '2026-08-30', mainValue: 1000 },
      [],
      '2026-09-06',
      prices([
        ['2026-08-28', 100],
        ['2026-09-04', 105],
        ['2026-09-07', 999],
      ]),
    );
    expect(replay.status).toBe('WARN');
    expect(replay.terminalPriceDate).toBe('2026-09-04');
    expect(replay.terminalValue).toBeCloseTo(1050, 12);
    expect(replay.ignoredFuturePricePoints).toBe(1);
  });

  it('requires exact prices only for flows after the baseline', () => {
    const replay = replayBenchmarkFromBaseline(
      world,
      { snapshotDate: '2026-08-03', mainValue: 1000 },
      [
        { date: '2025-01-02', amount: -5000 },
        { date: '2026-08-10', amount: -200 },
      ],
      '2026-08-31',
      prices([
        ['2026-08-03', 100],
        ['2026-08-31', 110],
      ]),
    );
    expect(replay.status).toBe('N/A');
    expect(replay.missingFlowDates).toEqual(['2026-08-10']);
  });

  it('needs only a short public-data window beginning shortly before the baseline', () => {
    expect(forwardBenchmarkRequestWindow('2026-08-30', '2026-09-30')).toEqual({
      from: '2026-08-23',
      to: '2026-09-30',
    });
  });

  it('returns the baseline value itself when no performance interval exists yet', () => {
    const replay = replayBenchmarkFromBaseline(
      world,
      { snapshotDate: '2026-08-28', mainValue: 1000 },
      [],
      '2026-08-28',
      prices([['2026-08-28', 100]]),
    );
    expect(replay.status).toBe('PASS');
    expect(replay.terminalValue).toBe(1000);
    expect(replay.xirr.status).toBe('N/A');
  });
});

describe('forward benchmark checkpoints', () => {
  it('advances synthetic units without requesting prices back to the original baseline', () => {
    const baseline = { snapshotDate: '2026-08-03', mainValue: 1000 };
    const allFlows = [
      { date: '2026-08-10', amount: -200 },
      { date: '2027-01-15', amount: -100 },
    ];
    const initial = replayBenchmarkFromBaseline(
      world,
      baseline,
      allFlows,
      '2026-08-31',
      prices([
        ['2026-08-03', 100],
        ['2026-08-10', 110],
        ['2026-08-31', 120],
      ]),
    );
    const checkpoint = checkpointFromReplay(baseline, '2026-08-31', initial);
    expect(checkpoint).not.toBeNull();

    const advanced = replayBenchmarkFromCheckpoint(
      world,
      baseline,
      checkpoint!,
      allFlows,
      '2027-08-31',
      prices([
        ['2027-01-15', 125],
        ['2027-08-31', 140],
      ]),
    );

    expect(advanced.status).toBe('PASS');
    expect(advanced.units).toBeCloseTo((initial.units ?? 0) + 100 / 125, 12);
    expect(advanced.terminalValue).toBeCloseTo(((initial.units ?? 0) + 100 / 125) * 140, 12);
    expect(advanced.note).toMatch(/Advanced local benchmark checkpoint/);
  });

  it('requests only from the last checkpoint onward', () => {
    expect(checkpointBenchmarkRequestWindow('2026-08-31', '2027-08-31')).toEqual({
      from: '2026-08-31',
      to: '2027-08-31',
    });
  });

  it('can reuse a checkpoint on its own as-of date without market prices', () => {
    const baseline = { snapshotDate: '2026-08-03', mainValue: 1000 };
    const initial = replayBenchmarkFromBaseline(
      world,
      baseline,
      [],
      '2026-08-31',
      prices([
        ['2026-08-03', 100],
        ['2026-08-31', 120],
      ]),
    );
    const checkpoint = checkpointFromReplay(baseline, '2026-08-31', initial)!;
    const reused = replayBenchmarkFromCheckpoint(world, baseline, checkpoint, [], '2026-08-31', []);
    expect(reused.terminalValue).toBeCloseTo(initial.terminalValue ?? 0, 12);
    expect(reused.units).toBeCloseTo(initial.units ?? 0, 12);
    expect(reused.note).toMatch(/Reused local benchmark checkpoint/);
  });

  it('rejects a checkpoint tied to a different baseline value', () => {
    const baseline = { snapshotDate: '2026-08-03', mainValue: 1000 };
    const initial = replayBenchmarkFromBaseline(
      world,
      baseline,
      [],
      '2026-08-31',
      prices([
        ['2026-08-03', 100],
        ['2026-08-31', 120],
      ]),
    );
    const checkpoint = checkpointFromReplay(baseline, '2026-08-31', initial)!;
    const incompatible = replayBenchmarkFromCheckpoint(
      world,
      { snapshotDate: '2026-08-03', mainValue: 1001 },
      checkpoint,
      [],
      '2026-09-01',
      prices([['2026-09-01', 121]]),
    );
    expect(incompatible.status).toBe('N/A');
    expect(incompatible.note).toMatch(/incompatible/i);
  });
});
