import type { LedgerAudit } from './domain';
import type { HistorySnapshot } from './history';

export function attachHistoryProvenance(
  snapshot: HistorySnapshot,
  sourceFingerprint: string | null,
  audit: LedgerAudit | null,
): HistorySnapshot {
  return {
    ...snapshot,
    sourceFingerprint,
    ledgerFirstDate: audit?.firstDate || null,
    ledgerLastDate: audit?.lastDate || null,
  };
}
