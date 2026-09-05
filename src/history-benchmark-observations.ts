import type { BenchmarkId } from './benchmark';
import type { ForwardBenchmarkCheckpoint } from './benchmark-forward';
import {
  loadHistorySnapshots,
  saveHistoryBenchmarkCheckpoint,
  saveHistorySnapshot,
  type HistorySnapshot,
} from './history';

function sameCheckpoint(
  a: ForwardBenchmarkCheckpoint | undefined,
  b: ForwardBenchmarkCheckpoint,
): boolean {
  return a != null &&
    a.benchmarkId === b.benchmarkId &&
    a.baselineDate === b.baselineDate &&
    Math.abs(a.baselineMainValue - b.baselineMainValue) <= 0.005 &&
    a.asOfDate === b.asOfDate &&
    Math.abs(a.terminalValue - b.terminalValue) <= 0.005 &&
    a.terminalPriceDate === b.terminalPriceDate &&
    Math.abs(a.terminalPrice - b.terminalPrice) <= 1e-9 &&
    Math.abs(a.units - b.units) <= 1e-12;
}

function currentBaseline(snapshots: HistorySnapshot[]): HistorySnapshot | null {
  return [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))[0] ?? null;
}

function observationForDate(
  snapshots: HistorySnapshot[],
  benchmarkId: BenchmarkId,
  snapshotDate: string,
): ForwardBenchmarkCheckpoint | null {
  const baseline = currentBaseline(snapshots);
  if (!baseline) return null;
  return snapshots
    .map((snapshot) => snapshot.benchmarkCheckpoints[benchmarkId])
    .filter((checkpoint): checkpoint is ForwardBenchmarkCheckpoint => checkpoint != null)
    .filter(
      (checkpoint) =>
        checkpoint.asOfDate === snapshotDate &&
        checkpoint.baselineDate === baseline.snapshotDate &&
        Math.abs(checkpoint.baselineMainValue - baseline.mainValue) <= 0.005,
    )
    .sort((a, b) => b.terminalPriceDate.localeCompare(a.terminalPriceDate))[0] ?? null;
}

async function attachObservationToSnapshot(
  snapshotDate: string,
  checkpoint: ForwardBenchmarkCheckpoint,
): Promise<boolean> {
  const snapshots = await loadHistorySnapshots();
  const owner = snapshots.find((snapshot) => snapshot.snapshotDate === snapshotDate);
  if (!owner) return false;
  if (sameCheckpoint(owner.benchmarkCheckpoints[checkpoint.benchmarkId], checkpoint)) return true;

  await saveHistorySnapshot({
    ...owner,
    benchmarkCheckpoints: {
      ...owner.benchmarkCheckpoints,
      [checkpoint.benchmarkId]: checkpoint,
    },
  });
  return true;
}

export async function persistBenchmarkObservation(
  baselineOwnerSnapshotDate: string,
  observationSnapshotDate: string,
  checkpoint: ForwardBenchmarkCheckpoint,
): Promise<boolean> {
  try {
    await saveHistoryBenchmarkCheckpoint(baselineOwnerSnapshotDate, checkpoint);
  } catch {
    return false;
  }

  if (observationSnapshotDate !== baselineOwnerSnapshotDate) {
    try {
      await attachObservationToSnapshot(observationSnapshotDate, checkpoint);
    } catch {
      // The observation snapshot may not have been explicitly saved yet. The baseline
      // checkpoint remains available and will be copied by backfillBenchmarkObservations.
    }
  }
  return true;
}

export async function backfillBenchmarkObservations(): Promise<number> {
  let snapshots = await loadHistorySnapshots();
  let updates = 0;
  for (const snapshot of snapshots) {
    if (snapshot === currentBaseline(snapshots)) continue;
    const additions: Partial<Record<BenchmarkId, ForwardBenchmarkCheckpoint>> = {};
    for (const benchmarkId of ['msci-world', 'sp500'] as BenchmarkId[]) {
      const checkpoint = observationForDate(snapshots, benchmarkId, snapshot.snapshotDate);
      if (!checkpoint || sameCheckpoint(snapshot.benchmarkCheckpoints[benchmarkId], checkpoint)) continue;
      additions[benchmarkId] = checkpoint;
    }
    if (Object.keys(additions).length === 0) continue;
    await saveHistorySnapshot({
      ...snapshot,
      benchmarkCheckpoints: { ...snapshot.benchmarkCheckpoints, ...additions },
    });
    updates += 1;
    snapshots = await loadHistorySnapshots();
  }
  return updates;
}
