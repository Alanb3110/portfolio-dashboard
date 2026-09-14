import type { BenchmarkId } from './benchmark';
import type { ForwardBenchmarkCheckpoint } from './benchmark-forward';
import {
  HISTORY_METHODOLOGY_VERSION,
  benchmarkBaselineSnapshot,
  type HistorySnapshot,
} from './history';

export interface HistoryChartPoint {
  date: string;
  portfolio: number;
  world: number | null;
  sp500: number | null;
}

export type HistoryChartSeriesKey = 'portfolio' | 'world' | 'sp500';

/**
 * Connects the observations that actually exist for a series. Missing values
 * stay absent from the snapshot data and do not create synthetic chart points.
 */
export function buildObservedSeriesPath(
  points: readonly HistoryChartPoint[],
  key: HistoryChartSeriesKey,
  x: (date: string) => number,
  y: (value: number) => number,
): string {
  let path = '';
  let hasObservation = false;
  for (const point of points) {
    const value = point[key];
    if (value == null) continue;
    path += `${hasObservation ? ' L' : ' M'} ${x(point.date).toFixed(2)} ${y(value).toFixed(2)}`;
    hasObservation = true;
  }
  return path;
}

function sortedUniqueSnapshots(snapshots: HistorySnapshot[]): HistorySnapshot[] {
  const byDate = new Map<string, HistorySnapshot>();
  for (const snapshot of snapshots) {
    const previous = byDate.get(snapshot.snapshotDate);
    if (!previous || snapshot.savedAt >= previous.savedAt) byDate.set(snapshot.snapshotDate, snapshot);
  }
  return [...byDate.values()].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
}

function compatibleCheckpoint(
  snapshots: HistorySnapshot[],
  benchmarkId: BenchmarkId,
  baseline: HistorySnapshot,
  asOfDate: string,
): ForwardBenchmarkCheckpoint | null {
  const candidates = snapshots
    .map((snapshot) => snapshot.benchmarkCheckpoints[benchmarkId])
    .filter((checkpoint): checkpoint is ForwardBenchmarkCheckpoint => checkpoint != null)
    .filter(
      (checkpoint) =>
        checkpoint.benchmarkId === benchmarkId &&
        checkpoint.baselineDate === baseline.snapshotDate &&
        Math.abs(checkpoint.baselineMainValue - baseline.mainValue) <= 0.005 &&
        checkpoint.asOfDate === asOfDate,
    )
    .sort((a, b) => b.terminalPriceDate.localeCompare(a.terminalPriceDate));
  return candidates[0] ?? null;
}

export function buildHistoryChartSeries(snapshots: HistorySnapshot[]): HistoryChartPoint[] {
  const ordered = sortedUniqueSnapshots(snapshots)
    .filter((snapshot) => snapshot.methodologyVersion === HISTORY_METHODOLOGY_VERSION);
  const baseline = benchmarkBaselineSnapshot(ordered);
  if (!baseline) return [];

  return ordered.map((snapshot) => {
    const isBaseline = snapshot.snapshotDate === baseline.snapshotDate;
    return {
      date: snapshot.snapshotDate,
      portfolio: snapshot.mainValue,
      world: isBaseline
        ? baseline.mainValue
        : compatibleCheckpoint(ordered, 'msci-world', baseline, snapshot.snapshotDate)?.terminalValue ?? null,
      sp500: isBaseline
        ? baseline.mainValue
        : compatibleCheckpoint(ordered, 'sp500', baseline, snapshot.snapshotDate)?.terminalValue ?? null,
    };
  });
}
