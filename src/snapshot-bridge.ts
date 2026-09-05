import type { NetWorthSnapshot } from './domain';

type SnapshotListener = (snapshot: NetWorthSnapshot) => void;

let currentSnapshot: NetWorthSnapshot | null = null;
const listeners = new Set<SnapshotListener>();

export function publishUiSnapshot(snapshot: NetWorthSnapshot): void {
  currentSnapshot = snapshot;
  for (const listener of listeners) listener(snapshot);
}

export function subscribeUiSnapshot(listener: SnapshotListener): () => void {
  listeners.add(listener);
  if (currentSnapshot) listener(currentSnapshot);
  return () => listeners.delete(listener);
}
