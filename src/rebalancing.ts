import { buildAllocationView, concentrationCoverageReliable } from './allocation';
import type { NetWorthSnapshot, SnapshotPosition } from './domain';

export const REBALANCING_SCHEMA_VERSION = 1 as const;

export interface RebalancingTarget {
  id: string;
  targetWeight: number;
}

export interface RebalancingTargetConfig {
  schemaVersion: typeof REBALANCING_SCHEMA_VERSION;
  savedAt: string;
  targets: RebalancingTarget[];
}

export interface RebalancingRow {
  id: string;
  name: string;
  symbol: string | null;
  pocket: 'Compte-titres' | 'PEA';
  currentValue: number;
  currentWeight: number;
  targetWeight: number;
  driftWeight: number;
  targetValue: number;
  valueGap: number;
}

export interface RebalancingResult {
  status: 'PASS' | 'INCOMPATIBLE' | 'N/A';
  note: string;
  mainValue: number;
  rows: RebalancingRow[];
  maxAbsDrift: number | null;
  internalReallocationEur: number | null;
  missingTargetIds: string[];
  staleTargetIds: string[];
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}.`);
  return value;
}

function targetFromUnknown(value: unknown, index: number): RebalancingTarget {
  if (typeof value !== 'object' || value == null) throw new Error(`Invalid target ${index}.`);
  const object = value as Record<string, unknown>;
  const id = text(object.id, `target ${index} id`);
  const targetWeight = object.targetWeight;
  if (typeof targetWeight !== 'number' || !Number.isFinite(targetWeight) || targetWeight < 0 || targetWeight > 1) {
    throw new Error(`Invalid target ${index} weight.`);
  }
  return { id, targetWeight };
}

export function mainPositionId(position: SnapshotPosition): string {
  return `${position.pocket}:${position.symbol ?? position.name}`;
}

export function mainPositions(snapshot: NetWorthSnapshot): Array<SnapshotPosition & { pocket: 'Compte-titres' | 'PEA' }> {
  return snapshot.positions
    .filter((position): position is SnapshotPosition & { pocket: 'Compte-titres' | 'PEA' } =>
      position.pocket === 'Compte-titres' || position.pocket === 'PEA',
    )
    .sort((a, b) => b.value - a.value);
}

export function validateTargetConfig(value: unknown): RebalancingTargetConfig {
  if (typeof value !== 'object' || value == null) throw new Error('Invalid rebalancing target config.');
  const object = value as Record<string, unknown>;
  if (object.schemaVersion !== REBALANCING_SCHEMA_VERSION) throw new Error('Unsupported rebalancing target schema.');
  const savedAt = text(object.savedAt, 'savedAt');
  if (Number.isNaN(Date.parse(savedAt))) throw new Error('Invalid savedAt.');
  if (!Array.isArray(object.targets) || object.targets.length === 0) throw new Error('At least one target is required.');
  const targets = object.targets.map(targetFromUnknown);
  const ids = new Set(targets.map((target) => target.id));
  if (ids.size !== targets.length) throw new Error('Duplicate rebalancing target id.');
  const sum = targets.reduce((total, target) => total + target.targetWeight, 0);
  if (Math.abs(sum - 1) > 0.001) throw new Error(`Target weights must sum to 100% (got ${(sum * 100).toFixed(2)}%).`);
  return { schemaVersion: REBALANCING_SCHEMA_VERSION, savedAt, targets };
}

export function createTargetConfig(
  targets: RebalancingTarget[],
  savedAt = new Date().toISOString(),
): RebalancingTargetConfig {
  return validateTargetConfig({
    schemaVersion: REBALANCING_SCHEMA_VERSION,
    savedAt,
    targets,
  });
}

export function computeRebalancing(
  snapshot: NetWorthSnapshot,
  config: RebalancingTargetConfig,
): RebalancingResult {
  const validated = validateTargetConfig(config);
  const allocation = buildAllocationView(snapshot, 'main');
  if (!concentrationCoverageReliable(allocation)) {
    return {
      status: 'N/A',
      note: 'Rebalancing unavailable because parsed main positions do not reconcile closely enough with the official main value.',
      mainValue: allocation.officialValue,
      rows: [],
      maxAbsDrift: null,
      internalReallocationEur: null,
      missingTargetIds: [],
      staleTargetIds: [],
    };
  }

  const positions = mainPositions(snapshot);
  const currentIds = new Set(positions.map(mainPositionId));
  const targetById = new Map(validated.targets.map((target) => [target.id, target.targetWeight]));
  const missingTargetIds = positions.map(mainPositionId).filter((id) => !targetById.has(id));
  const staleTargetIds = validated.targets.map((target) => target.id).filter((id) => !currentIds.has(id));
  if (missingTargetIds.length > 0 || staleTargetIds.length > 0) {
    return {
      status: 'INCOMPATIBLE',
      note: 'Saved targets no longer match the current set of main positions. Update targets before using drift values.',
      mainValue: allocation.officialValue,
      rows: [],
      maxAbsDrift: null,
      internalReallocationEur: null,
      missingTargetIds,
      staleTargetIds,
    };
  }

  const rows = positions.map((position) => {
    const id = mainPositionId(position);
    const targetWeight = targetById.get(id)!;
    const currentWeight = allocation.officialValue > 0 ? position.value / allocation.officialValue : 0;
    const targetValue = allocation.officialValue * targetWeight;
    return {
      id,
      name: position.name,
      symbol: position.symbol,
      pocket: position.pocket,
      currentValue: position.value,
      currentWeight,
      targetWeight,
      driftWeight: currentWeight - targetWeight,
      targetValue,
      valueGap: targetValue - position.value,
    } satisfies RebalancingRow;
  }).sort((a, b) => Math.abs(b.driftWeight) - Math.abs(a.driftWeight));

  const maxAbsDrift = rows.length > 0 ? Math.max(...rows.map((row) => Math.abs(row.driftWeight))) : null;
  const internalReallocationEur = rows.length > 0
    ? rows.reduce((sum, row) => sum + Math.abs(row.valueGap), 0) / 2
    : null;

  return {
    status: 'PASS',
    note: 'Mechanical drift versus user-defined targets at the current official main-portfolio value.',
    mainValue: allocation.officialValue,
    rows,
    maxAbsDrift,
    internalReallocationEur,
    missingTargetIds: [],
    staleTargetIds: [],
  };
}
