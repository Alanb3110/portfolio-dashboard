import { describe, expect, it } from 'vitest';
import { buildAllocationView } from '../src/allocation';
import { BENCHMARKS, type BenchmarkPricePoint } from '../src/benchmark';
import { replayBenchmarkFromBaseline } from '../src/benchmark-forward';
import type { NetWorthSnapshot } from '../src/domain';
import { buildHistoryChartSeries } from '../src/history-chart';
import {
  HISTORY_SCHEMA_VERSION,
  compareHistorySnapshots,
  mergeHistorySnapshots,
  previousHistorySnapshot,
  type HistorySnapshot,
} from '../src/history';
import { computePeriodPerformance, computeStoredPeriodPerformance } from '../src/period-performance';
import {
  computeContributionRebalancing,
  computeRebalancing,
  createTargetConfig,
} from '../src/rebalancing';

const EUR_TOLERANCE = 1e-8;
const WEIGHT_TOLERANCE = 1e-12;

function dateFromOffset(days: number): string {
  const date = new Date('2025-01-01T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function snapshot(
  date: string,
  mainValue: number,
  overrides: Partial<HistorySnapshot> = {},
): HistorySnapshot {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    methodologyVersion: '5.1',
    sourceFingerprint: 'synthetic-depth',
    ledgerFirstDate: '2025-01-01',
    ledgerLastDate: date,
    ledgerCutoffDate: date,
    snapshotDate: date,
    savedAt: `${date}T12:00:00.000Z`,
    mainValue,
    extendedInvestedValue: mainValue,
    totalNetWorth: mainValue,
    simpleEconomicPnl: mainValue - 1000,
    mainXirr: null,
    summary: {
      compteTitres: mainValue,
      pea: 0,
      crypto: 0,
      nonCote: 0,
      cash: 0,
      total: mainValue,
    },
    mainPositions: [],
    benchmarkCheckpoints: {},
    ...overrides,
  };
}

function benchmarkPrices(points: Array<[string, number]>): BenchmarkPricePoint[] {
  return points.map(([date, adjustedClose]) => ({ date, adjustedClose }));
}

function allocationFixture(): NetWorthSnapshot {
  return {
    snapshotDate: '2026-06-30',
    generatedAt: null,
    summary: {
      compteTitres: 300,
      pea: 700,
      crypto: 250,
      nonCote: 100,
      cash: 50,
      total: 1400,
    },
    positions: [
      { pocket: 'PEA', name: 'A', symbol: 'A', shares: 1, price: 400, value: 400 },
      { pocket: 'PEA', name: 'B', symbol: 'B', shares: 1, price: 300, value: 300 },
      { pocket: 'Compte-titres', name: 'C', symbol: 'C', shares: 1, price: 200, value: 200 },
      { pocket: 'Compte-titres', name: 'D', symbol: 'D', shares: 1, price: 100, value: 100 },
      { pocket: 'Crypto', name: 'Synthetic crypto', symbol: 'CRYPTO', shares: 1, price: 250, value: 250 },
    ],
    warnings: [],
  };
}

function rebalancingFixture(): NetWorthSnapshot {
  return {
    snapshotDate: '2026-06-30',
    generatedAt: null,
    summary: {
      compteTitres: 1000,
      pea: 4000,
      crypto: 0,
      nonCote: 0,
      cash: 0,
      total: 5000,
    },
    positions: [
      { pocket: 'PEA', name: 'World', symbol: 'WORLD', shares: 1, price: 3000, value: 3000 },
      { pocket: 'PEA', name: 'Europe', symbol: 'EU', shares: 1, price: 1000, value: 1000 },
      { pocket: 'Compte-titres', name: 'Gold', symbol: 'GOLD', shares: 1, price: 1000, value: 1000 },
    ],
    warnings: [],
  };
}

describe('v5.2 deterministic depth validation', () => {
  it('A — orders 30 sparse snapshots, selects previous/latest and never invents missing benchmark points', () => {
    const values = Array.from({ length: 30 }, (_, index) => {
      if (index === 0) return 1000;
      if (index === 1) return 1100;
      if (index === 2 || index === 3) return 950;
      return 950 + index * 17 + (index % 4) * 9;
    });
    const snapshots = values.map((value, index) => snapshot(dateFromOffset(index * 10), value));
    const baseline = snapshots[0]!;
    const observed = snapshots[10]!;
    observed.benchmarkCheckpoints['msci-world'] = {
      method: 'forward-matched-flow-v1',
      benchmarkId: 'msci-world',
      baselineDate: baseline.snapshotDate,
      baselineMainValue: baseline.mainValue,
      asOfDate: observed.snapshotDate,
      units: 10,
      terminalValue: 1234,
      terminalPriceDate: observed.snapshotDate,
      terminalPrice: 123.4,
    };

    const duplicateOlder = snapshot(snapshots[5]!.snapshotDate, 999999, {
      savedAt: `${snapshots[5]!.snapshotDate}T11:00:00.000Z`,
    });
    const ordered = mergeHistorySnapshots([], [...snapshots].reverse().concat(duplicateOlder));

    expect(ordered).toHaveLength(30);
    expect(ordered[0]!.snapshotDate).toBe(snapshots[0]!.snapshotDate);
    expect(ordered.at(-1)!.snapshotDate).toBe(snapshots.at(-1)!.snapshotDate);
    expect(ordered[5]!.mainValue).toBe(snapshots[5]!.mainValue);

    const latest = ordered.at(-1)!;
    const previous = previousHistorySnapshot(ordered, latest.snapshotDate)!;
    expect(previous.snapshotDate).toBe(ordered.at(-2)!.snapshotDate);
    const comparison = compareHistorySnapshots(latest, previous);
    expect(comparison.mainValueDelta).toBeCloseTo(latest.mainValue - previous.mainValue, 12);

    const points = buildHistoryChartSeries(ordered);
    expect(points[10]!.world).toBeCloseTo(1234, 12);
    expect(points[9]!.world).toBeNull();
    expect(points[11]!.world).toBeNull();
    expect(points[10]!.sp500).toBeNull();
  });

  it('B — separates a contribution from economic performance', () => {
    // 1000 -> 1600 with a 500 EUR contribution means +600 raw, +500 capital, +100 P&L.
    const result = computePeriodPerformance(
      '2026-01-01',
      1000,
      '2026-02-01',
      1600,
      [{ date: '2026-01-15', amount: -500 }],
    );
    expect(result.rawValueDelta).toBeCloseTo(600, 12);
    expect(result.netContributionEur).toBeCloseTo(500, 12);
    expect(result.economicPnl).toBeCloseTo(100, 12);
    expect(result.canonicalCashflowSum).toBeCloseTo(-500, 12);
  });

  it('C — preserves withdrawal/sale signs without treating the withdrawal as a loss', () => {
    // 1000 -> 850 after 300 EUR leaves the holdings scope: -150 raw + 300 withdrawn = +150 P&L.
    const result = computePeriodPerformance(
      '2026-01-01',
      1000,
      '2026-02-01',
      850,
      [{ date: '2026-01-20', amount: 300 }],
    );
    expect(result.rawValueDelta).toBeCloseTo(-150, 12);
    expect(result.netContributionEur).toBeCloseTo(-300, 12);
    expect(result.economicPnl).toBeCloseTo(150, 12);
    expect(result.canonicalCashflowSum).toBeCloseTo(300, 12);
  });

  it('D/E — reproduces World and S&P 500 matched-flow terminal values from independent arithmetic', () => {
    const flows = [
      { date: '2026-01-15', amount: -220 },
      { date: '2026-02-16', amount: 130 },
    ];
    const baseline = { snapshotDate: '2026-01-02', mainValue: 1000 };

    const world = replayBenchmarkFromBaseline(
      BENCHMARKS['msci-world'],
      baseline,
      flows,
      '2026-03-02',
      benchmarkPrices([
        ['2026-01-02', 100],
        ['2026-01-15', 110],
        ['2026-02-16', 130],
        ['2026-03-02', 140],
      ]),
    );
    const expectedWorldUnits = 1000 / 100 + 220 / 110 - 130 / 130;
    const expectedWorldTerminal = expectedWorldUnits * 140;
    expect(world.status).toBe('PASS');
    expect(world.units).toBeCloseTo(expectedWorldUnits, 12);
    expect(world.terminalValue).toBeCloseTo(expectedWorldTerminal, 12);
    expect(Math.abs((world.terminalValue ?? 0) - 1540)).toBeLessThan(EUR_TOLERANCE);

    const sp500 = replayBenchmarkFromBaseline(
      BENCHMARKS.sp500,
      baseline,
      flows,
      '2026-03-02',
      benchmarkPrices([
        ['2026-01-02', 50],
        ['2026-01-15', 60],
        ['2026-02-16', 80],
        ['2026-03-02', 90],
      ]),
    );
    const expectedSpUnits = 1000 / 50 + 220 / 60 - 130 / 80;
    const expectedSpTerminal = expectedSpUnits * 90;
    expect(sp500.status).toBe('PASS');
    expect(sp500.units).toBeCloseTo(expectedSpUnits, 12);
    expect(sp500.terminalValue).toBeCloseTo(expectedSpTerminal, 12);
    expect(Math.abs((sp500.terminalValue ?? 0) - 1983.75)).toBeLessThan(EUR_TOLERANCE);

    // Primary benchmark identity is fixed public proxy metadata, independent of portfolio holdings.
    expect(BENCHMARKS['msci-world'].ticker).toBe('EUNL');
    expect(BENCHMARKS.sp500.ticker).toBe('SXR8');
  });

  it('F — makes incomplete benchmark data explicit instead of interpolating it', () => {
    const noBaseline = replayBenchmarkFromBaseline(
      BENCHMARKS['msci-world'],
      { snapshotDate: '2026-01-10', mainValue: 1000 },
      [],
      '2026-01-20',
      benchmarkPrices([['2026-01-12', 101], ['2026-01-20', 105]]),
    );
    expect(noBaseline.status).toBe('N/A');

    const weekdayGap = replayBenchmarkFromBaseline(
      BENCHMARKS['msci-world'],
      { snapshotDate: '2026-08-03', mainValue: 1000 },
      [{ date: '2026-08-10', amount: -200 }],
      '2026-08-31',
      benchmarkPrices([
        ['2026-08-03', 100],
        ['2026-08-07', 105],
        ['2026-08-11', 111],
        ['2026-08-31', 120],
      ]),
    );
    expect(weekdayGap.status).toBe('N/A');
    expect(weekdayGap.missingFlowDates).toEqual(['2026-08-10']);

    const noPrices = replayBenchmarkFromBaseline(
      BENCHMARKS.sp500,
      { snapshotDate: '2026-01-02', mainValue: 1000 },
      [],
      '2026-01-30',
      [],
    );
    expect(noPrices.status).toBe('N/A');

    const sameDay = replayBenchmarkFromBaseline(
      BENCHMARKS.sp500,
      { snapshotDate: '2026-01-02', mainValue: 1000 },
      [],
      '2026-01-02',
      benchmarkPrices([['2026-01-02', 50]]),
    );
    expect(sameDay.status).toBe('PASS');
    expect(sameDay.terminalValue).toBeCloseTo(1000, 12);
    expect(sameDay.xirr.status).toBe('N/A');
  });

  it('G — computes stored-period performance only with a common known ledger start date', () => {
    const previous = snapshot('2026-01-01', 1000, { simpleEconomicPnl: 0 });
    const current = snapshot('2026-02-01', 1600, { simpleEconomicPnl: 100 });
    const compatible = computeStoredPeriodPerformance(previous, current);
    expect(compatible.status).toBe('PASS');
    expect(compatible.rawValueDelta).toBeCloseTo(600, 12);
    expect(compatible.economicPnl).toBeCloseTo(100, 12);
    expect(compatible.netContributionEur).toBeCloseTo(500, 12);

    const differentStart = computeStoredPeriodPerformance(
      previous,
      { ...current, ledgerFirstDate: '2024-01-01' },
    );
    expect(differentStart.status).toBe('N/A');

    const unknownStart = computeStoredPeriodPerformance(
      { ...previous, ledgerFirstDate: null },
      current,
    );
    expect(unknownStart.status).toBe('N/A');
  });

  it('H — matches independent allocation concentration arithmetic', () => {
    const view = buildAllocationView(allocationFixture(), 'main');
    const expectedWeights = [0.4, 0.3, 0.2, 0.1];
    const expectedHhi = expectedWeights.reduce((sum, weight) => sum + weight ** 2, 0);
    expect(view.officialValue).toBeCloseTo(1000, 12);
    expect(view.positions.map((position) => position.weight)).toEqual(
      expect.arrayContaining(expectedWeights.map((weight) => expect.closeTo(weight, 12))),
    );
    expect(view.top1Weight).toBeCloseTo(0.4, 12);
    expect(view.top3Weight).toBeCloseTo(0.9, 12);
    expect(view.hhi).toBeCloseTo(expectedHhi, 12);
    expect(view.effectivePositionCount).toBeCloseTo(1 / expectedHhi, 12);
    expect(Math.abs((view.hhi ?? 0) - 0.3)).toBeLessThan(WEIGHT_TOLERANCE);
  });

  it('I — preserves current rebalancing and buy-only steering semantics', () => {
    const snapshot = rebalancingFixture();
    const targets = createTargetConfig([
      { id: 'PEA:WORLD', targetWeight: 0.5 },
      { id: 'PEA:EU', targetWeight: 0.3 },
      { id: 'Compte-titres:GOLD', targetWeight: 0.2 },
    ], '2026-06-30T12:00:00.000Z');

    const drift = computeRebalancing(snapshot, targets);
    expect(drift.status).toBe('PASS');
    expect(drift.rows.find((row) => row.id === 'PEA:WORLD')!.valueGap).toBeCloseTo(-500, 12);
    expect(drift.rows.find((row) => row.id === 'PEA:EU')!.valueGap).toBeCloseTo(500, 12);
    expect(drift.internalReallocationEur).toBeCloseTo(500, 12);

    const buyOnly = computeContributionRebalancing(snapshot, targets, 1000);
    expect(buyOnly.status).toBe('PASS');
    expect(buyOnly.rows.find((row) => row.id === 'PEA:WORLD')!.purchaseEur).toBeCloseTo(0, 12);
    expect(buyOnly.rows.find((row) => row.id === 'PEA:EU')!.purchaseEur).toBeCloseTo(800, 12);
    expect(buyOnly.rows.find((row) => row.id === 'Compte-titres:GOLD')!.purchaseEur).toBeCloseTo(200, 12);
    expect(buyOnly.rows.every((row) => row.purchaseEur >= 0)).toBe(true);

    const balancedTargets = createTargetConfig([
      { id: 'PEA:WORLD', targetWeight: 0.6 },
      { id: 'PEA:EU', targetWeight: 0.2 },
      { id: 'Compte-titres:GOLD', targetWeight: 0.2 },
    ], '2026-06-30T12:00:00.000Z');
    const balanced = computeRebalancing(snapshot, balancedTargets);
    expect(balanced.status).toBe('PASS');
    expect(balanced.rows.every((row) => Math.abs(row.driftWeight) < WEIGHT_TOLERANCE)).toBe(true);
  });
});
