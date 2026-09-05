import type { NetWorthSnapshot, PositionPocket, SnapshotPosition } from './domain';

export type AllocationViewId = 'main' | 'pea' | 'ct' | 'crypto';

export interface AllocationPosition extends SnapshotPosition {
  weight: number;
}

export interface AllocationView {
  id: AllocationViewId;
  label: string;
  officialValue: number;
  parsedPositionValue: number;
  coverageRatio: number | null;
  positions: AllocationPosition[];
  top1Weight: number | null;
  top3Weight: number | null;
  hhi: number | null;
  effectivePositionCount: number | null;
}

const VIEW_CONFIG: Record<AllocationViewId, { label: string; pockets: PositionPocket[] }> = {
  main: { label: 'Principal', pockets: ['Compte-titres', 'PEA'] },
  pea: { label: 'PEA', pockets: ['PEA'] },
  ct: { label: 'Compte-titres', pockets: ['Compte-titres'] },
  crypto: { label: 'Crypto', pockets: ['Crypto'] },
};

function officialValue(snapshot: NetWorthSnapshot, id: AllocationViewId): number {
  switch (id) {
    case 'main':
      return snapshot.summary.compteTitres + snapshot.summary.pea;
    case 'pea':
      return snapshot.summary.pea;
    case 'ct':
      return snapshot.summary.compteTitres;
    case 'crypto':
      return snapshot.summary.crypto;
  }
}

export function buildAllocationView(snapshot: NetWorthSnapshot, id: AllocationViewId): AllocationView {
  const config = VIEW_CONFIG[id];
  const total = officialValue(snapshot, id);
  const selected = snapshot.positions
    .filter((position) => config.pockets.includes(position.pocket))
    .sort((a, b) => b.value - a.value);
  const parsedPositionValue = selected.reduce((sum, position) => sum + position.value, 0);
  const positions = selected.map((position) => ({
    ...position,
    weight: total > 0 ? position.value / total : 0,
  }));
  const weights = positions.map((position) => position.weight);
  const top1Weight = weights.length > 0 ? weights[0]! : null;
  const top3Weight = weights.length > 0 ? weights.slice(0, 3).reduce((sum, weight) => sum + weight, 0) : null;
  const hhi = weights.length > 0 ? weights.reduce((sum, weight) => sum + weight * weight, 0) : null;

  return {
    id,
    label: config.label,
    officialValue: total,
    parsedPositionValue,
    coverageRatio: total > 0 ? parsedPositionValue / total : parsedPositionValue === 0 ? 1 : null,
    positions,
    top1Weight,
    top3Weight,
    hhi,
    effectivePositionCount: hhi != null && hhi > 0 ? 1 / hhi : null,
  };
}

export function buildAllocationViews(snapshot: NetWorthSnapshot): Record<AllocationViewId, AllocationView> {
  return {
    main: buildAllocationView(snapshot, 'main'),
    pea: buildAllocationView(snapshot, 'pea'),
    ct: buildAllocationView(snapshot, 'ct'),
    crypto: buildAllocationView(snapshot, 'crypto'),
  };
}

export function concentrationCoverageReliable(view: AllocationView, tolerance = 0.01): boolean {
  return view.coverageRatio != null && Math.abs(view.coverageRatio - 1) <= tolerance;
}
