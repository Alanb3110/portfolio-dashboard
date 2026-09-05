import type { BenchmarkId } from './benchmark';
import type { ForwardBenchmarkCheckpoint } from './benchmark-forward';
import type { HistorySnapshot } from './history';

export interface HistoryChartPoint {
  date: string;
  portfolio: number;
  world: number | null;
  sp500: number | null;
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
  const ordered = sortedUniqueSnapshots(snapshots);
  const baseline = ordered[0];
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
