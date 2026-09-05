import { describe, expect, it } from 'vitest';
import {
  HISTORY_METHODOLOGY_VERSION,
  buildHistoryBackup,
  compareHistorySnapshots,
  createHistorySnapshot,
  mergeHistorySnapshots,
  parseHistoryBackup,
  previousHistorySnapshot,
  type HistorySnapshot,
} from '../src/history';
import type { NetWorthSnapshot, PortfolioAnalysis } from '../src/domain';

function historySnapshot(overrides: Partial<HistorySnapshot> = {}): HistorySnapshot {
  return {
    schemaVersion: 2,
    methodologyVersion: HISTORY_METHODOLOGY_VERSION,
    sourceFingerprint: null,
    ledgerFirstDate: null,
    ledgerLastDate: null,
    ledgerCutoffDate: '2026-08-01',
    snapshotDate: '2026-08-01',
    savedAt: '2026-08-01T12:00:00.000Z',
    mainValue: 1000,
    extendedInvestedValue: 1100,
    totalNetWorth: 1300,
    simpleEconomicPnl: 100,
    mainXirr: 0.12,
    summary: {
      compteTitres: 400,
      pea: 600,
      crypto: 100,
      nonCote: 50,
      cash: 150,
      total: 1300,
    },
    mainPositions: [
      {
        id: 'PEA:TEST-A',
        name: 'Synthetic A',
        symbol: 'TEST-A',
        pocket: 'PEA',
        value: 600,
        weight: 0.6,
      },
      {
        id: 'Compte-titres:TEST-B',
        name: 'Synthetic B',
        symbol: 'TEST-B',
        pocket: 'Compte-titres',
        value: 400,
        weight: 0.4,
      },
    ],
    benchmarkCheckpoints: {},
    ...overrides,
  };
}

const analysis: PortfolioAnalysis = {
  snapshotDate: '2026-08-30',
  mainValue: 1200,
  extendedInvestedValue: 1320,
  totalNetWorth: 1520,
  simpleEconomicPnl: 180,
  mainXirr: {
    status: 'PASS',
    roots: [0.15],
    selectedRoot: 0.15,
    residual: 0,
    note: 'Synthetic root.',
  },
  transactionCount: 10,
  positionCount: 4,
  warnings: [],
};

const netWorth: NetWorthSnapshot = {
  snapshotDate: '2026-08-30',
  generatedAt: null,
  summary: {
    compteTitres: 480,
    pea: 720,
    crypto: 120,
    nonCote: 50,
    cash: 150,
    total: 1520,
  },
  positions: [
    { pocket: 'PEA', name: 'Synthetic A', symbol: 'TEST-A', shares: 1, price: 660, value: 660 },
    { pocket: 'Compte-titres', name: 'Synthetic B', symbol: 'TEST-B', shares: 1, price: 540, value: 540 },
    { pocket: 'Crypto', name: 'Synthetic Crypto', symbol: 'CRYPTO', shares: 1, price: 120, value: 120 },
    { pocket: 'Non cote', name: 'Synthetic Private', symbol: null, shares: 1, price: 50, value: 50 },
  ],
  warnings: [],
};

describe('local snapshot history', () => {
  it('persists derived values only with scoped main-position identities', () => {
    const snapshot = createHistorySnapshot(analysis, netWorth, '2026-08-30T20:00:00.000Z');
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.methodologyVersion).toBe(HISTORY_METHODOLOGY_VERSION);
    expect(snapshot.ledgerCutoffDate).toBe('2026-08-30');
    expect(snapshot.snapshotDate).toBe('2026-08-30');
    expect(snapshot.mainPositions.map((position) => position.id)).toEqual([
      'PEA:TEST-A',
      'Compte-titres:TEST-B',
    ]);
    expect(snapshot.mainPositions.reduce((sum, position) => sum + position.weight, 0)).toBeCloseTo(1, 12);
    expect(snapshot.benchmarkCheckpoints).toEqual({});
    expect(Object.keys(snapshot)).not.toContain('transactions');
    expect(Object.keys(snapshot)).not.toContain('pdf');
  });

  it('resolves duplicate snapshot dates deterministically using the latest savedAt', () => {
    const old = historySnapshot();
    const newer = historySnapshot({ savedAt: '2026-08-01T13:00:00.000Z', mainValue: 1100 });
    const merged = mergeHistorySnapshots([newer], [old]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.mainValue).toBe(1100);
  });

  it('keeps the latest compatible benchmark checkpoint when duplicate snapshots are merged', () => {
    const old = historySnapshot({
      benchmarkCheckpoints: {
        'msci-world': {
          method: 'forward-matched-flow-v1',
          benchmarkId: 'msci-world',
          baselineDate: '2026-08-01',
          baselineMainValue: 1000,
          asOfDate: '2026-08-15',
          units: 10,
          terminalValue: 1050,
          terminalPriceDate: '2026-08-15',
          terminalPrice: 105,
        },
      },
    });
    const newerCheckpoint = historySnapshot({
      savedAt: '2026-08-01T13:00:00.000Z',
      benchmarkCheckpoints: {
        'msci-world': {
          method: 'forward-matched-flow-v1',
          benchmarkId: 'msci-world',
          baselineDate: '2026-08-01',
          baselineMainValue: 1000,
          asOfDate: '2026-08-30',
          units: 10,
          terminalValue: 1100,
          terminalPriceDate: '2026-08-30',
          terminalPrice: 110,
        },
      },
    });
    const merged = mergeHistorySnapshots([old], [newerCheckpoint]);
    expect(merged[0]?.benchmarkCheckpoints['msci-world']?.asOfDate).toBe('2026-08-30');
  });

  it('round-trips a versioned v2 backup and rejects corrupted data', () => {
    const backup = buildHistoryBackup([historySnapshot()], '2026-08-30T20:00:00.000Z');
    const parsed = parseHistoryBackup(JSON.stringify(backup));
    expect(parsed).toEqual(backup);

    const corrupted = structuredClone(backup) as unknown as { snapshots: Array<Record<string, unknown>> };
    corrupted.snapshots[0]!.mainValue = 'not-a-number';
    expect(() => parseHistoryBackup(JSON.stringify(corrupted))).toThrow(/mainValue/);
  });

  it('migrates v1 backups without losing snapshots and scopes legacy position identities', () => {
    const legacy = {
      schemaVersion: 1,
      exportedAt: '2026-08-30T20:00:00.000Z',
      snapshots: [
        {
          schemaVersion: 1,
          snapshotDate: '2026-08-01',
          savedAt: '2026-08-01T12:00:00.000Z',
          mainValue: 1000,
          extendedInvestedValue: 1100,
          totalNetWorth: 1300,
          simpleEconomicPnl: 100,
          mainXirr: 0.12,
          summary: historySnapshot().summary,
          mainPositions: [
            { id: 'TEST', name: 'Synthetic', symbol: 'TEST', pocket: 'PEA', value: 600, weight: 0.6 },
            { id: 'TEST', name: 'Synthetic', symbol: 'TEST', pocket: 'Compte-titres', value: 400, weight: 0.4 },
          ],
        },
      ],
    };

    const parsed = parseHistoryBackup(JSON.stringify(legacy));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.snapshots).toHaveLength(1);
    expect(parsed.snapshots[0]?.methodologyVersion).toBe('5.0-legacy');
    expect(parsed.snapshots[0]?.ledgerCutoffDate).toBe('2026-08-01');
    expect(parsed.snapshots[0]?.benchmarkCheckpoints).toEqual({});
    expect(parsed.snapshots[0]?.mainPositions.map((position) => position.id).sort()).toEqual([
      'Compte-titres:TEST',
      'PEA:TEST',
    ]);
  });

  it('rejects unsupported backup schema versions instead of silently guessing them', () => {
    const backup = buildHistoryBackup([historySnapshot()], '2026-08-30T20:00:00.000Z') as unknown as Record<string, unknown>;
    backup.schemaVersion = 99;
    expect(() => parseHistoryBackup(JSON.stringify(backup))).toThrow(/Unsupported backup schema version/);
  });

  it('selects the latest earlier snapshot and computes value/allocation deltas', () => {
    const first = historySnapshot({ snapshotDate: '2026-08-01', ledgerCutoffDate: '2026-08-01' });
    const second = historySnapshot({
      snapshotDate: '2026-08-15',
      ledgerCutoffDate: '2026-08-15',
      savedAt: '2026-08-15T12:00:00.000Z',
      mainValue: 1100,
      mainPositions: [
        { id: 'PEA:TEST-A', name: 'Synthetic A', symbol: 'TEST-A', pocket: 'PEA', value: 715, weight: 0.65 },
        { id: 'Compte-titres:TEST-B', name: 'Synthetic B', symbol: 'TEST-B', pocket: 'Compte-titres', value: 385, weight: 0.35 },
      ],
    });
    const current = historySnapshot({
      snapshotDate: '2026-08-30',
      ledgerCutoffDate: '2026-08-30',
      savedAt: '2026-08-30T12:00:00.000Z',
      mainValue: 1200,
      mainPositions: [
        { id: 'PEA:TEST-A', name: 'Synthetic A', symbol: 'TEST-A', pocket: 'PEA', value: 720, weight: 0.6 },
        { id: 'Compte-titres:TEST-B', name: 'Synthetic B', symbol: 'TEST-B', pocket: 'Compte-titres', value: 480, weight: 0.4 },
      ],
    });

    const previous = previousHistorySnapshot([first, current, second], current.snapshotDate);
    expect(previous?.snapshotDate).toBe('2026-08-15');
    const comparison = compareHistorySnapshots(current, previous!);
    expect(comparison.mainValueDelta).toBe(100);
    expect(comparison.mainValueDeltaRatio).toBeCloseTo(1200 / 1100 - 1, 12);
    expect(comparison.allocationDeltas.find((item) => item.id === 'PEA:TEST-A')?.weightDelta).toBeCloseTo(-0.05, 12);
  });
});
