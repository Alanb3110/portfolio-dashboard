import type { LedgerRow, NetWorthSnapshot, PositionPocket } from './domain';

export type ReconciliationStatus = 'PASS' | 'WARN' | 'FAIL';

export interface QuantityReconciliationItem {
  id: string;
  pocket: 'Compte-titres' | 'PEA';
  symbol: string;
  ledgerQuantity: number;
  snapshotQuantity: number;
  delta: number;
  tolerance: number;
  status: 'PASS' | 'FAIL';
}

export interface MainPositionReconciliation {
  status: ReconciliationStatus;
  items: QuantityReconciliationItem[];
  unresolvedLedgerRows: number;
  unresolvedSnapshotPositions: number;
  note: string;
}

function mainPocket(row: LedgerRow): 'Compte-titres' | 'PEA' | null {
  if (row.scope !== 'main') return null;
  if (row.accountType === 'PEA') return 'PEA';
  if (row.accountType === 'DEFAULT') return 'Compte-titres';
  return null;
}

function isQuantityBearing(row: LedgerRow): boolean {
  return (
    (row.category === 'TRADING' && (row.type === 'BUY' || row.type === 'SELL')) ||
    (row.category === 'DELIVERY' && (row.type === 'MIGRATION' || row.type === 'FREE_RECEIPT')) ||
    (row.category === 'CORPORATE_ACTION' && row.type === 'SPLIT')
  );
}

function quantityTolerance(reference: number): number {
  return Math.max(1e-6, Math.abs(reference) * 1e-9);
}

export function reconcileMainPositionQuantities(
  ledger: LedgerRow[],
  snapshot: NetWorthSnapshot,
): MainPositionReconciliation {
  const applicableLedger = ledger.filter((row) => row.date <= snapshot.snapshotDate);
  const quantityRows = applicableLedger.filter((row) => row.scope === 'main' && isQuantityBearing(row));

  const unresolvedLedgerRows = quantityRows.filter(
    (row) => row.symbol == null || row.shares == null || mainPocket(row) == null,
  ).length;

  const ledgerQuantities = new Map<string, { pocket: 'Compte-titres' | 'PEA'; symbol: string; quantity: number }>();
  for (const row of quantityRows) {
    const pocket = mainPocket(row);
    if (!pocket || row.symbol == null || row.shares == null) continue;
    const id = `${pocket}:${row.symbol}`;
    const current = ledgerQuantities.get(id)?.quantity ?? 0;
    ledgerQuantities.set(id, { pocket, symbol: row.symbol, quantity: current + row.shares });
  }

  const mainSnapshotPositions = snapshot.positions.filter(
    (position): position is typeof position & { pocket: 'Compte-titres' | 'PEA' } =>
      position.pocket === 'Compte-titres' || position.pocket === 'PEA',
  );
  const unresolvedSnapshotPositions = mainSnapshotPositions.filter((position) => position.symbol == null).length;

  const snapshotQuantities = new Map<string, { pocket: 'Compte-titres' | 'PEA'; symbol: string; quantity: number }>();
  for (const position of mainSnapshotPositions) {
    if (position.symbol == null) continue;
    const id = `${position.pocket}:${position.symbol}`;
    const current = snapshotQuantities.get(id)?.quantity ?? 0;
    snapshotQuantities.set(id, {
      pocket: position.pocket,
      symbol: position.symbol,
      quantity: current + position.shares,
    });
  }

  const ids = new Set([...ledgerQuantities.keys(), ...snapshotQuantities.keys()]);
  const items = [...ids]
    .map((id): QuantityReconciliationItem => {
      const ledgerEntry = ledgerQuantities.get(id);
      const snapshotEntry = snapshotQuantities.get(id);
      const identity = snapshotEntry ?? ledgerEntry;
      if (!identity) throw new Error('Internal reconciliation identity error.');
      const ledgerQuantity = ledgerEntry?.quantity ?? 0;
      const snapshotQuantity = snapshotEntry?.quantity ?? 0;
      const delta = ledgerQuantity - snapshotQuantity;
      const tolerance = quantityTolerance(snapshotQuantity);
      return {
        id,
        pocket: identity.pocket,
        symbol: identity.symbol,
        ledgerQuantity,
        snapshotQuantity,
        delta,
        tolerance,
        status: Math.abs(delta) <= tolerance ? 'PASS' : 'FAIL',
      };
    })
    .filter((item) => Math.abs(item.ledgerQuantity) > item.tolerance || Math.abs(item.snapshotQuantity) > item.tolerance)
    .sort((a, b) => a.id.localeCompare(b.id));

  const failed = items.filter((item) => item.status === 'FAIL');
  let status: ReconciliationStatus = 'PASS';
  if (failed.length > 0) status = 'FAIL';
  else if (unresolvedLedgerRows > 0 || unresolvedSnapshotPositions > 0) status = 'WARN';

  const notes: string[] = [];
  if (failed.length > 0) notes.push(`${failed.length} main position quantity mismatch(es).`);
  if (unresolvedLedgerRows > 0) notes.push(`${unresolvedLedgerRows} quantity-bearing ledger row(s) could not be reconciled.`);
  if (unresolvedSnapshotPositions > 0) notes.push(`${unresolvedSnapshotPositions} main snapshot position(s) have no symbol.`);
  if (notes.length === 0) notes.push(`${items.length} open main position(s) reconcile within tolerance.`);

  return {
    status,
    items,
    unresolvedLedgerRows,
    unresolvedSnapshotPositions,
    note: notes.join(' '),
  };
}
