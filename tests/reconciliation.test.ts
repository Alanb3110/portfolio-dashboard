import { describe, expect, it } from 'vitest';
import { analyzePortfolio } from '../src/analytics';
import type { LedgerRow, NetWorthSnapshot } from '../src/domain';
import { reconcileMainPositionQuantities } from '../src/reconciliation';

function quantityRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    datetime: '2026-01-01T10:00:00Z',
    date: '2026-01-01',
    accountType: 'PEA',
    category: 'TRADING',
    type: 'BUY',
    assetClass: 'FUND',
    name: 'Synthetic',
    symbol: 'TEST',
    shares: 10,
    price: 100,
    amount: -1000,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    description: null,
    transactionId: 'tx',
    scope: 'main',
    economicCashflowEur: -1000,
    quantityEffect: 10,
    mainPerformanceCashflowEur: -1000,
    ...overrides,
  };
}

function snapshot(positions: NetWorthSnapshot['positions']): NetWorthSnapshot {
  const pea = positions.filter((position) => position.pocket === 'PEA').reduce((sum, position) => sum + position.value, 0);
  const compteTitres = positions
    .filter((position) => position.pocket === 'Compte-titres')
    .reduce((sum, position) => sum + position.value, 0);
  return {
    snapshotDate: '2026-01-31',
    generatedAt: null,
    summary: {
      compteTitres,
      pea,
      crypto: 0,
      nonCote: 0,
      cash: 0,
      total: compteTitres + pea,
    },
    positions,
    warnings: [],
  };
}

describe('main ledger ↔ snapshot quantity reconciliation', () => {
  it('reconciles signed buys and sells against the official snapshot', () => {
    const result = reconcileMainPositionQuantities(
      [
        quantityRow({ shares: 12, quantityEffect: 12, transactionId: 'buy' }),
        quantityRow({ type: 'SELL', shares: -2, quantityEffect: -2, transactionId: 'sell' }),
      ],
      snapshot([
        { pocket: 'PEA', name: 'Synthetic', symbol: 'TEST', shares: 10, price: 110, value: 1100 },
      ]),
    );

    expect(result.status).toBe('PASS');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.ledgerQuantity).toBe(10);
    expect(result.items[0]?.snapshotQuantity).toBe(10);
  });

  it('keeps the same symbol in PEA and Compte-titres as separate identities', () => {
    const result = reconcileMainPositionQuantities(
      [
        quantityRow({ accountType: 'PEA', shares: 5, quantityEffect: 5, transactionId: 'pea' }),
        quantityRow({ accountType: 'DEFAULT', shares: 2, quantityEffect: 2, transactionId: 'ct' }),
      ],
      snapshot([
        { pocket: 'PEA', name: 'Synthetic', symbol: 'TEST', shares: 5, price: 100, value: 500 },
        { pocket: 'Compte-titres', name: 'Synthetic', symbol: 'TEST', shares: 2, price: 100, value: 200 },
      ]),
    );

    expect(result.status).toBe('PASS');
    expect(result.items.map((item) => item.id).sort()).toEqual(['Compte-titres:TEST', 'PEA:TEST']);
  });

  it('fails when reconstructed and official quantities disagree', () => {
    const result = reconcileMainPositionQuantities(
      [quantityRow()],
      snapshot([
        { pocket: 'PEA', name: 'Synthetic', symbol: 'TEST', shares: 9, price: 100, value: 900 },
      ]),
    );

    expect(result.status).toBe('FAIL');
    expect(result.items[0]?.delta).toBe(1);
    expect(result.note).toMatch(/1 main position quantity mismatch/i);
  });

  it('surfaces a failed reconciliation in portfolio analysis warnings', () => {
    const analysis = analyzePortfolio(
      [quantityRow()],
      snapshot([
        { pocket: 'PEA', name: 'Synthetic', symbol: 'TEST', shares: 9, price: 100, value: 900 },
      ]),
    );
    expect(analysis.warnings.some((warning) => warning.startsWith('Main position reconciliation FAIL.'))).toBe(true);
  });

  it('ignores quantity changes occurring after the snapshot date', () => {
    const result = reconcileMainPositionQuantities(
      [
        quantityRow(),
        quantityRow({
          date: '2026-02-01',
          datetime: '2026-02-01T10:00:00Z',
          shares: 5,
          quantityEffect: 5,
          transactionId: 'future',
        }),
      ],
      snapshot([
        { pocket: 'PEA', name: 'Synthetic', symbol: 'TEST', shares: 10, price: 100, value: 1000 },
      ]),
    );

    expect(result.status).toBe('PASS');
    expect(result.items[0]?.ledgerQuantity).toBe(10);
  });

  it('returns WARN when a quantity-bearing row cannot be identified', () => {
    const result = reconcileMainPositionQuantities(
      [quantityRow({ symbol: null })],
      snapshot([]),
    );
    expect(result.status).toBe('WARN');
    expect(result.unresolvedLedgerRows).toBe(1);
  });
});
