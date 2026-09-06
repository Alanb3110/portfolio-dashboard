import { describe, expect, it } from 'vitest';
import { computePeriodPerformance, computeStoredPeriodPerformance } from '../src/period-performance';
import type { HistorySnapshot } from '../src/history';

function storedSnapshot(overrides: Partial<HistorySnapshot> = {}): HistorySnapshot {
  return {
    schemaVersion: 2,
    methodologyVersion: '5.1',
    sourceFingerprint: 'synthetic',
    ledgerFirstDate: '2025-01-01',
    ledgerLastDate: '2026-01-01',
    ledgerCutoffDate: '2026-01-01',
    snapshotDate: '2026-01-01',
    savedAt: '2026-01-01T12:00:00.000Z',
    mainValue: 5000,
    extendedInvestedValue: 5000,
    totalNetWorth: 5000,
    simpleEconomicPnl: 500,
    mainXirr: 0.1,
    summary: {
      compteTitres: 0,
      pea: 5000,
      crypto: 0,
      nonCote: 0,
      cash: 0,
      total: 5000,
    },
    mainPositions: [],
    benchmarkCheckpoints: {},
    ...overrides,
  };
}

describe('snapshot-to-snapshot period performance', () => {
  it('separates a contribution from economic performance', () => {
    const result = computePeriodPerformance(
      '2026-01-01',
      5000,
      '2026-02-01',
      6100,
      [{ date: '2026-01-15', amount: -1000 }],
    );

    expect(result.rawValueDelta).toBe(1100);
    expect(result.netContributionEur).toBe(1000);
    expect(result.economicPnl).toBe(100);
    expect(result.canonicalCashflowSum).toBe(-1000);
    expect(result.days).toBe(31);
  });

  it('treats a sale or distribution as money leaving the main holdings scope', () => {
    const result = computePeriodPerformance(
      '2026-01-01',
      5000,
      '2026-02-01',
      4600,
      [{ date: '2026-01-20', amount: 500 }],
    );

    expect(result.rawValueDelta).toBe(-400);
    expect(result.netContributionEur).toBe(-500);
    expect(result.economicPnl).toBe(100);
  });

  it('ignores flows outside the open-start/closed-end snapshot interval', () => {
    const result = computePeriodPerformance(
      '2026-01-10',
      1000,
      '2026-02-10',
      1100,
      [
        { date: '2026-01-10', amount: -400 },
        { date: '2026-01-20', amount: -100 },
        { date: '2026-02-10', amount: 20 },
        { date: '2026-02-11', amount: -500 },
      ],
    );

    expect(result.canonicalCashflowSum).toBe(-80);
    expect(result.netContributionEur).toBe(80);
    expect(result.economicPnl).toBe(20);
  });

  it('uses the existing frozen forward XIRR convention', () => {
    const result = computePeriodPerformance(
      '2025-01-01',
      1000,
      '2026-01-01',
      1100,
      [],
    );

    expect(result.xirr.status).toBe('PASS');
    expect(result.xirr.selectedRoot ?? 0).toBeCloseTo(0.1, 8);
  });

  it('rejects a non-positive snapshot interval', () => {
    expect(() => computePeriodPerformance('2026-01-01', 1000, '2026-01-01', 1000, [])).toThrow(/Invalid snapshot period/);
  });

  it('recovers the same period P&L from compatible cumulative stored snapshots', () => {
    const previous = storedSnapshot({
      snapshotDate: '2026-01-01',
      ledgerCutoffDate: '2026-01-01',
      mainValue: 5000,
      simpleEconomicPnl: 500,
    });
    const current = storedSnapshot({
      snapshotDate: '2026-02-01',
      ledgerCutoffDate: '2026-02-01',
      ledgerLastDate: '2026-02-01',
      mainValue: 6100,
      simpleEconomicPnl: 600,
    });

    const result = computeStoredPeriodPerformance(previous, current);
    expect(result.status).toBe('PASS');
    expect(result.rawValueDelta).toBe(1100);
    expect(result.economicPnl).toBe(100);
    expect(result.netContributionEur).toBe(1000);
  });

  it('refuses stored-period performance when ledger inception changed', () => {
    const previous = storedSnapshot({ snapshotDate: '2026-01-01', ledgerCutoffDate: '2026-01-01' });
    const current = storedSnapshot({
      snapshotDate: '2026-02-01',
      ledgerCutoffDate: '2026-02-01',
      ledgerFirstDate: '2024-01-01',
    });

    const result = computeStoredPeriodPerformance(previous, current);
    expect(result.status).toBe('N/A');
    expect(result.economicPnl).toBeNull();
    expect(result.note).toMatch(/same known ledger start date/i);
  });

  it('refuses to mix legacy and frozen v5.1 methodologies', () => {
    const previous = storedSnapshot({
      snapshotDate: '2026-01-01',
      ledgerCutoffDate: '2026-01-01',
      methodologyVersion: '5.0-legacy',
    });
    const current = storedSnapshot({ snapshotDate: '2026-02-01', ledgerCutoffDate: '2026-02-01' });

    expect(computeStoredPeriodPerformance(previous, current).status).toBe('N/A');
  });
});
