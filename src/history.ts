import type { BenchmarkId } from './benchmark';
import type { ForwardBenchmarkCheckpoint } from './benchmark-forward';
import type { NetWorthSnapshot, NetWorthSummary, PortfolioAnalysis } from './domain';

export const HISTORY_SCHEMA_VERSION = 2 as const;
export const HISTORY_METHODOLOGY_VERSION = '5.1' as const;
const LEGACY_METHODOLOGY_VERSION = '5.0-legacy';
const DB_NAME = 'portfolio-dashboard-v5';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

export interface HistoryPosition {
  id: string;
  name: string;
  symbol: string | null;
  pocket: 'Compte-titres' | 'PEA';
  value: number;
  weight: number;
}

export interface HistorySnapshot {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  methodologyVersion: string;
  sourceFingerprint: string | null;
  ledgerFirstDate: string | null;
  ledgerLastDate: string | null;
  ledgerCutoffDate: string;
  snapshotDate: string;
  savedAt: string;
  mainValue: number;
  extendedInvestedValue: number;
  totalNetWorth: number;
  simpleEconomicPnl: number;
  mainXirr: number | null;
  summary: NetWorthSummary;
  mainPositions: HistoryPosition[];
  benchmarkCheckpoints: Partial<Record<BenchmarkId, ForwardBenchmarkCheckpoint>>;
}

export interface HistoryBackup {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  exportedAt: string;
  snapshots: HistorySnapshot[];
}

export interface SnapshotComparison {
  previousDate: string;
  mainValueDelta: number;
  mainValueDeltaRatio: number | null;
  allocationDeltas: Array<{
    id: string;
    name: string;
    symbol: string | null;
    weightDelta: number;
  }>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function nonNegativeFinite(value: unknown, label: string): number {
  const parsed = finite(value, label);
  if (parsed < 0) throw new Error(`Invalid ${label}.`);
  return parsed;
}

function positiveFinite(value: unknown, label: string): number {
  const parsed = finite(value, label);
  if (parsed <= 0) throw new Error(`Invalid ${label}.`);
  return parsed;
}

function nullableFinite(value: unknown, label: string): number | null {
  if (value == null) return null;
  return finite(value, label);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}.`);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  if (value == null) return null;
  return text(value, label);
}

function isoDate(value: unknown, label: string): string {
  const raw = text(value, label);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid ${label}.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${label}.`);
  }
  return raw;
}

function nullableIsoDate(value: unknown, label: string): string | null {
  if (value == null) return null;
  return isoDate(value, label);
}

function isoInstant(value: unknown, label: string): string {
  const raw = text(value, label);
  if (Number.isNaN(Date.parse(raw))) throw new Error(`Invalid ${label}.`);
  return raw;
}

function summaryFromUnknown(value: unknown): NetWorthSummary {
  if (typeof value !== 'object' || value == null) throw new Error('Invalid snapshot summary.');
  const object = value as Record<string, unknown>;
  return {
    compteTitres: finite(object.compteTitres, 'summary.compteTitres'),
    pea: finite(object.pea, 'summary.pea'),
    crypto: finite(object.crypto, 'summary.crypto'),
    nonCote: finite(object.nonCote, 'summary.nonCote'),
    cash: finite(object.cash, 'summary.cash'),
    total: finite(object.total, 'summary.total'),
  };
}

function canonicalPositionId(pocket: 'Compte-titres' | 'PEA', symbol: string | null, name: string): string {
  return `${pocket}:${symbol ?? name}`;
}

function positionFromUnknown(value: unknown): HistoryPosition {
  if (typeof value !== 'object' || value == null) throw new Error('Invalid history position.');
  const object = value as Record<string, unknown>;
  const pocket = text(object.pocket, 'position.pocket');
  if (pocket !== 'Compte-titres' && pocket !== 'PEA') throw new Error('Invalid position.pocket.');
  const symbol = object.symbol == null ? null : text(object.symbol, 'position.symbol');
  const name = text(object.name, 'position.name');
  return {
    id: canonicalPositionId(pocket, symbol, name),
    name,
    symbol,
    pocket,
    value: finite(object.value, 'position.value'),
    weight: finite(object.weight, 'position.weight'),
  };
}

function checkpointFromUnknown(value: unknown, benchmarkId: BenchmarkId): ForwardBenchmarkCheckpoint {
  if (typeof value !== 'object' || value == null) throw new Error(`Invalid ${benchmarkId} benchmark checkpoint.`);
  const object = value as Record<string, unknown>;
  const method = text(object.method, `${benchmarkId}.method`);
  if (method !== 'forward-matched-flow-v1') throw new Error(`Unsupported ${benchmarkId} benchmark checkpoint method.`);
  const storedBenchmarkId = text(object.benchmarkId, `${benchmarkId}.benchmarkId`);
  if (storedBenchmarkId !== benchmarkId) throw new Error(`Invalid ${benchmarkId} benchmark checkpoint identity.`);
  const baselineDate = isoDate(object.baselineDate, `${benchmarkId}.baselineDate`);
  const asOfDate = isoDate(object.asOfDate, `${benchmarkId}.asOfDate`);
  const terminalPriceDate = isoDate(object.terminalPriceDate, `${benchmarkId}.terminalPriceDate`);
  if (baselineDate > asOfDate || terminalPriceDate > asOfDate) {
    throw new Error(`Invalid ${benchmarkId} benchmark checkpoint dates.`);
  }
  return {
    method,
    benchmarkId,
    baselineDate,
    baselineMainValue: nonNegativeFinite(object.baselineMainValue, `${benchmarkId}.baselineMainValue`),
    asOfDate,
    units: nonNegativeFinite(object.units, `${benchmarkId}.units`),
    terminalValue: nonNegativeFinite(object.terminalValue, `${benchmarkId}.terminalValue`),
    terminalPriceDate,
    terminalPrice: positiveFinite(object.terminalPrice, `${benchmarkId}.terminalPrice`),
  };
}

function benchmarkCheckpointsFromUnknown(
  value: unknown,
): Partial<Record<BenchmarkId, ForwardBenchmarkCheckpoint>> {
  if (value == null) return {};
  if (typeof value !== 'object') throw new Error('Invalid benchmarkCheckpoints.');
  const object = value as Record<string, unknown>;
  const allowed = new Set<BenchmarkId>(['msci-world', 'sp500']);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key as BenchmarkId)) throw new Error(`Unknown benchmark checkpoint: ${key}.`);
  }
  const result: Partial<Record<BenchmarkId, ForwardBenchmarkCheckpoint>> = {};
  for (const benchmarkId of allowed) {
    if (object[benchmarkId] != null) result[benchmarkId] = checkpointFromUnknown(object[benchmarkId], benchmarkId);
  }
  return result;
}

function laterCheckpoint(
  a: ForwardBenchmarkCheckpoint | undefined,
  b: ForwardBenchmarkCheckpoint | undefined,
): ForwardBenchmarkCheckpoint | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.baselineDate !== b.baselineDate || Math.abs(a.baselineMainValue - b.baselineMainValue) > 0.005) {
    return b.asOfDate >= a.asOfDate ? b : a;
  }
  return b.asOfDate >= a.asOfDate ? b : a;
}

function mergeBenchmarkCheckpoints(
  a: Partial<Record<BenchmarkId, ForwardBenchmarkCheckpoint>>,
  b: Partial<Record<BenchmarkId, ForwardBenchmarkCheckpoint>>,
): Partial<Record<BenchmarkId, ForwardBenchmarkCheckpoint>> {
  const result: Partial<Record<BenchmarkId, ForwardBenchmarkCheckpoint>> = {};
  for (const benchmarkId of ['msci-world', 'sp500'] as BenchmarkId[]) {
    const checkpoint = laterCheckpoint(a[benchmarkId], b[benchmarkId]);
    if (checkpoint) result[benchmarkId] = checkpoint;
  }
  return result;
}

function validateV2HistorySnapshot(object: Record<string, unknown>): HistorySnapshot {
  if (!Array.isArray(object.mainPositions)) throw new Error('Invalid mainPositions.');
  const snapshotDate = isoDate(object.snapshotDate, 'snapshotDate');
  const ledgerCutoffDate = isoDate(object.ledgerCutoffDate, 'ledgerCutoffDate');
  if (ledgerCutoffDate !== snapshotDate) {
    throw new Error('ledgerCutoffDate must match snapshotDate.');
  }
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    methodologyVersion: text(object.methodologyVersion, 'methodologyVersion'),
    sourceFingerprint: nullableText(object.sourceFingerprint, 'sourceFingerprint'),
    ledgerFirstDate: nullableIsoDate(object.ledgerFirstDate, 'ledgerFirstDate'),
    ledgerLastDate: nullableIsoDate(object.ledgerLastDate, 'ledgerLastDate'),
    ledgerCutoffDate,
    snapshotDate,
    savedAt: isoInstant(object.savedAt, 'savedAt'),
    mainValue: finite(object.mainValue, 'mainValue'),
    extendedInvestedValue: finite(object.extendedInvestedValue, 'extendedInvestedValue'),
    totalNetWorth: finite(object.totalNetWorth, 'totalNetWorth'),
    simpleEconomicPnl: finite(object.simpleEconomicPnl, 'simpleEconomicPnl'),
    mainXirr: nullableFinite(object.mainXirr, 'mainXirr'),
    summary: summaryFromUnknown(object.summary),
    mainPositions: object.mainPositions.map(positionFromUnknown),
    benchmarkCheckpoints: benchmarkCheckpointsFromUnknown(object.benchmarkCheckpoints),
  };
}

export function validateHistorySnapshot(value: unknown): HistorySnapshot {
  if (typeof value !== 'object' || value == null) throw new Error('Invalid history snapshot.');
  const object = value as Record<string, unknown>;

  if (object.schemaVersion === 1) {
    const snapshotDate = isoDate(object.snapshotDate, 'snapshotDate');
    return validateV2HistorySnapshot({
      ...object,
      schemaVersion: HISTORY_SCHEMA_VERSION,
      methodologyVersion: LEGACY_METHODOLOGY_VERSION,
      sourceFingerprint: null,
      ledgerFirstDate: null,
      ledgerLastDate: null,
      ledgerCutoffDate: snapshotDate,
      benchmarkCheckpoints: {},
    });
  }

  if (object.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported history snapshot schema: ${String(object.schemaVersion)}.`);
  }
  return validateV2HistorySnapshot(object);
}

export function createHistorySnapshot(
  analysis: PortfolioAnalysis,
  snapshot: NetWorthSnapshot,
  savedAt = new Date().toISOString(),
): HistorySnapshot {
  const mainPositions = snapshot.positions
    .filter((position): position is typeof position & { pocket: 'Compte-titres' | 'PEA' } =>
      position.pocket === 'Compte-titres' || position.pocket === 'PEA',
    )
    .map((position) => ({
      id: canonicalPositionId(position.pocket, position.symbol, position.name),
      name: position.name,
      symbol: position.symbol,
      pocket: position.pocket,
      value: position.value,
      weight: analysis.mainValue > 0 ? position.value / analysis.mainValue : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return validateHistorySnapshot({
    schemaVersion: HISTORY_SCHEMA_VERSION,
    methodologyVersion: HISTORY_METHODOLOGY_VERSION,
    sourceFingerprint: null,
    ledgerFirstDate: null,
    ledgerLastDate: null,
    ledgerCutoffDate: analysis.snapshotDate,
    snapshotDate: analysis.snapshotDate,
    savedAt,
    mainValue: analysis.mainValue,
    extendedInvestedValue: analysis.extendedInvestedValue,
    totalNetWorth: analysis.totalNetWorth,
    simpleEconomicPnl: analysis.simpleEconomicPnl,
    mainXirr: analysis.mainXirr.selectedRoot,
    summary: snapshot.summary,
    mainPositions,
    benchmarkCheckpoints: {},
  });
}

export function mergeHistorySnapshots(
  existing: HistorySnapshot[],
  incoming: HistorySnapshot[],
): HistorySnapshot[] {
  const byDate = new Map<string, HistorySnapshot>();
  for (const raw of [...existing, ...incoming]) {
    const record = validateHistorySnapshot(raw);
    const previous = byDate.get(record.snapshotDate);
    if (!previous) {
      byDate.set(record.snapshotDate, record);
      continue;
    }
    const winner = record.savedAt >= previous.savedAt ? record : previous;
    const checkpoints = mergeBenchmarkCheckpoints(previous.benchmarkCheckpoints, record.benchmarkCheckpoints);
    byDate.set(record.snapshotDate, { ...winner, benchmarkCheckpoints: checkpoints });
  }
  return [...byDate.values()].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
}

export function previousHistorySnapshot(
  snapshots: HistorySnapshot[],
  currentDate: string,
): HistorySnapshot | null {
  return snapshots
    .filter((snapshot) => snapshot.snapshotDate < currentDate)
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0] ?? null;
}

export function compareHistorySnapshots(
  current: HistorySnapshot,
  previous: HistorySnapshot,
): SnapshotComparison {
  const previousWeights = new Map(previous.mainPositions.map((position) => [position.id, position.weight]));
  const currentById = new Map(current.mainPositions.map((position) => [position.id, position]));
  const ids = new Set([...previousWeights.keys(), ...currentById.keys()]);
  const allocationDeltas = [...ids]
    .map((id) => {
      const position = currentById.get(id) ?? previous.mainPositions.find((candidate) => candidate.id === id);
      if (!position) throw new Error('History position identity mismatch.');
      return {
        id,
        name: position.name,
        symbol: position.symbol,
        weightDelta: (currentById.get(id)?.weight ?? 0) - (previousWeights.get(id) ?? 0),
      };
    })
    .sort((a, b) => Math.abs(b.weightDelta) - Math.abs(a.weightDelta));

  return {
    previousDate: previous.snapshotDate,
    mainValueDelta: current.mainValue - previous.mainValue,
    mainValueDeltaRatio: previous.mainValue !== 0 ? current.mainValue / previous.mainValue - 1 : null,
    allocationDeltas,
  };
}

export function buildHistoryBackup(
  snapshots: HistorySnapshot[],
  exportedAt = new Date().toISOString(),
): HistoryBackup {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    exportedAt: isoInstant(exportedAt, 'exportedAt'),
    snapshots: mergeHistorySnapshots([], snapshots),
  };
}

export function parseHistoryBackup(textContent: string): HistoryBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(textContent);
  } catch {
    throw new Error('Backup JSON is malformed.');
  }
  if (typeof raw !== 'object' || raw == null) throw new Error('Backup root is invalid.');
  const object = raw as Record<string, unknown>;
  if (object.schemaVersion !== 1 && object.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schema version: ${String(object.schemaVersion)}.`);
  }
  if (!Array.isArray(object.snapshots)) throw new Error('Backup snapshots are invalid.');
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    exportedAt: isoInstant(object.exportedAt, 'exportedAt'),
    snapshots: mergeHistorySnapshots([], object.snapshots.map(validateHistorySnapshot)),
  };
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function openHistoryDb(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'snapshotDate' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local history database.'));
  });
}

async function putHistorySnapshot(record: HistorySnapshot): Promise<void> {
  const db = await openHistoryDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    await transactionPromise(transaction);
  } finally {
    db.close();
  }
}

export async function loadHistorySnapshots(): Promise<HistorySnapshot[]> {
  const db = await openHistoryDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const rows = await requestPromise(transaction.objectStore(STORE_NAME).getAll());
    return mergeHistorySnapshots([], rows.map(validateHistorySnapshot));
  } finally {
    db.close();
  }
}

export async function saveHistorySnapshot(snapshot: HistorySnapshot): Promise<void> {
  const record = validateHistorySnapshot(snapshot);
  const existing = (await loadHistorySnapshots()).find((candidate) => candidate.snapshotDate === record.snapshotDate);
  const preserveCheckpoints = existing != null && Math.abs(existing.mainValue - record.mainValue) <= 0.005;
  const mergedRecord = {
    ...record,
    benchmarkCheckpoints: preserveCheckpoints
      ? mergeBenchmarkCheckpoints(existing.benchmarkCheckpoints, record.benchmarkCheckpoints)
      : record.benchmarkCheckpoints,
  };
  await putHistorySnapshot(validateHistorySnapshot(mergedRecord));
}

export async function saveHistoryBenchmarkCheckpoint(
  ownerSnapshotDate: string,
  checkpoint: ForwardBenchmarkCheckpoint,
): Promise<void> {
  const validatedCheckpoint = checkpointFromUnknown(checkpoint, checkpoint.benchmarkId);
  const existing = (await loadHistorySnapshots()).find((candidate) => candidate.snapshotDate === ownerSnapshotDate);
  if (!existing) throw new Error(`Benchmark checkpoint owner snapshot ${ownerSnapshotDate} does not exist.`);
  if (
    validatedCheckpoint.baselineDate !== existing.snapshotDate ||
    Math.abs(validatedCheckpoint.baselineMainValue - existing.mainValue) > 0.005
  ) {
    throw new Error('Benchmark checkpoint baseline does not match its owner snapshot.');
  }
  const benchmarkCheckpoints = mergeBenchmarkCheckpoints(existing.benchmarkCheckpoints, {
    [validatedCheckpoint.benchmarkId]: validatedCheckpoint,
  });
  await putHistorySnapshot(validateHistorySnapshot({ ...existing, benchmarkCheckpoints }));
}

export async function importHistorySnapshots(incoming: HistorySnapshot[]): Promise<HistorySnapshot[]> {
  const existing = await loadHistorySnapshots();
  const merged = mergeHistorySnapshots(existing, incoming);
  const db = await openHistoryDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    for (const snapshot of merged) store.put(snapshot);
    await transactionPromise(transaction);
  } finally {
    db.close();
  }
  return merged;
}

export async function eraseHistorySnapshots(): Promise<void> {
  const db = await openHistoryDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    await transactionPromise(transaction);
  } finally {
    db.close();
  }
}
