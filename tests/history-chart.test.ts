import { describe, expect, it } from 'vitest';
import type { ForwardBenchmarkCheckpoint } from '../src/benchmark-forward';
import { buildHistoryChartSeries } from '../src/history-chart';
import { HISTORY_SCHEMA_VERSION, type HistorySnapshot } from '../src/history';

function snapshot(date: string, mainValue: number): HistorySnapshot {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    methodologyVersion: '5.1',
    sourceFingerprint: null,
    ledgerFirstDate: '2026-01-01',
    ledgerLastDate: date,
    ledgerCutoffDate: date,
    snapshotDate: date,
    savedAt: `${date}T12:00:00.000Z`,
    mainValue,
    extendedInvestedValue: mainValue,
    totalNetWorth: mainValue,
    simpleEconomicPnl: 0,
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
  };
}

function checkpoint(
  benchmarkId: 'msci-world' | 'sp500',
  baselineDate: string,
  baselineMainValue: number,
  asOfDate: string,
  terminalValue: number,
): ForwardBenchmarkCheckpoint {
  return {
    method: 'forward-matched-flow-v1',
    benchmarkId,
    baselineDate,
    baselineMainValue,
    asOfDate,
    units: 10,
    terminalValue,
    terminalPriceDate: asOfDate,
    terminalPrice: terminalValue / 10,
  };
}

describe('buildHistoryChartSeries', () => {
  it('uses the first saved snapshot as the common matched-flow baseline', () => {
    const first = snapshot('2026-09-05', 6000);
    expect(buildHistoryChartSeries([first])).toEqual([
      { date: '2026-09-05', portfolio: 6000, world: 6000, sp500: 6000 },
    ]);
  });

  it('finds historical benchmark observations even when stored on the baseline record', () => {
    const first = snapshot('2026-09-05', 6000);
    const second = snapshot('2026-10-05', 6200);
    first.benchmarkCheckpoints['msci-world'] = checkpoint('msci-world', '2026-09-05', 6000, '2026-10-05', 6150);
    first.benchmarkCheckpoints.sp500 = checkpoint('sp500', '2026-09-05', 6000, '2026-10-05', 6180);

    expect(buildHistoryChartSeries([second, first])).toEqual([
      { date: '2026-09-05', portfolio: 6000, world: 6000, sp500: 6000 },
      { date: '2026-10-05', portfolio: 6200, world: 6150, sp500: 6180 },
    ]);
  });

  it('keeps missing benchmark observations as null instead of interpolating them', () => {
    const first = snapshot('2026-09-05', 6000);
    const second = snapshot('2026-10-05', 6200);
    second.benchmarkCheckpoints['msci-world'] = checkpoint('msci-world', '2026-09-05', 6000, '2026-10-05', 6150);

    expect(buildHistoryChartSeries([first, second])[1]).toEqual({
      date: '2026-10-05',
      portfolio: 6200,
      world: 6150,
      sp500: null,
    });
  });

  it('rejects checkpoints from an incompatible baseline', () => {
    const first = snapshot('2026-09-05', 6000);
    const second = snapshot('2026-10-05', 6200);
    second.benchmarkCheckpoints.sp500 = checkpoint('sp500', '2026-09-10', 6100, '2026-10-05', 6300);

    expect(buildHistoryChartSeries([first, second])[1]!.sp500).toBeNull();
  });
});