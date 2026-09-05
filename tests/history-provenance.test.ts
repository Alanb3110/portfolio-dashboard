import { describe, expect, it } from 'vitest';
import type { LedgerAudit } from '../src/domain';
import { attachHistoryProvenance } from '../src/history-provenance';
import type { HistorySnapshot } from '../src/history';

function snapshot(): HistorySnapshot {
  return {
    schemaVersion: 2,
    methodologyVersion: '5.1',
    sourceFingerprint: null,
    ledgerFirstDate: null,
    ledgerLastDate: null,
    ledgerCutoffDate: '2026-09-05',
    snapshotDate: '2026-09-05',
    savedAt: '2026-09-05T12:00:00.000Z',
    mainValue: 1000,
    extendedInvestedValue: 1100,
    totalNetWorth: 1200,
    simpleEconomicPnl: 100,
    mainXirr: 0.1,
    summary: {
      compteTitres: 400,
      pea: 600,
      crypto: 100,
      nonCote: 0,
      cash: 100,
      total: 1200,
    },
    mainPositions: [],
    benchmarkCheckpoints: {},
  };
}

const audit: LedgerAudit = {
  rows: 10,
  uniqueTransactionIds: 10,
  duplicateTransactionIds: 0,
  firstDate: '2023-11-13',
  lastDate: '2026-09-05',
  dateVsParisMismatches: 0,
  mainRelevantDateVsParisMismatches: 0,
  mainBuySellRows: 5,
  mainRequiredMarketFieldsComplete: 5,
  unresolvedMissingTradeAmounts: 0,
};

describe('History v2 provenance', () => {
  it('attaches the local source fingerprint and audited ledger date bounds', () => {
    const enriched = attachHistoryProvenance(snapshot(), 'sha256:synthetic', audit);
    expect(enriched.sourceFingerprint).toBe('sha256:synthetic');
    expect(enriched.ledgerFirstDate).toBe('2023-11-13');
    expect(enriched.ledgerLastDate).toBe('2026-09-05');
    expect(enriched.ledgerCutoffDate).toBe('2026-09-05');
  });

  it('preserves explicit null provenance when unavailable', () => {
    const enriched = attachHistoryProvenance(snapshot(), null, null);
    expect(enriched.sourceFingerprint).toBeNull();
    expect(enriched.ledgerFirstDate).toBeNull();
    expect(enriched.ledgerLastDate).toBeNull();
  });
});
