import { describe, expect, it } from 'vitest';
import { analyzePortfolio, solveXirr, xnpv } from '../src/analytics';
import type { LedgerRow, NetWorthSnapshot } from '../src/domain';

function trade(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    datetime: '2025-01-01T10:00:00Z',
    date: '2025-01-01',
    accountType: 'PEA',
    category: 'TRADING',
    type: 'BUY',
    assetClass: 'FUND',
    name: 'Synthetic World',
    symbol: 'TEST00000001',
    shares: 10,
    price: 100,
    amount: -1000,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    description: null,
    transactionId: 'synthetic-1',
    scope: 'main',
    economicCashflowEur: -1000,
    quantityEffect: 10,
    mainPerformanceCashflowEur: -1000,
    ...overrides,
  };
}

const snapshot: NetWorthSnapshot = {
  snapshotDate: '2026-01-01',
  generatedAt: null,
  summary: {
    compteTitres: 0,
    pea: 1100,
    crypto: 100,
    nonCote: 50,
    cash: 250,
    total: 1500,
  },
  positions: [],
  warnings: [],
};

describe('XIRR', () => {
  it('solves a simple one-year investment close to 10%', () => {
    const result = solveXirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ]);
    expect(result.status).toBe('PASS');
    expect(result.selectedRoot).not.toBeNull();
    expect(result.selectedRoot ?? 0).toBeCloseTo(0.1, 3);
    expect(Math.abs(result.residual ?? 1)).toBeLessThan(1e-6);
  });

  it('does not select an arbitrary root when multiple roots exist', () => {
    const result = solveXirr([
      { date: '2023-01-01', amount: -100 },
      { date: '2024-01-01', amount: 230 },
      { date: '2025-01-01', amount: -132 },
    ]);
    expect(result.status).toBe('WARN');
    expect(result.selectedRoot).toBeNull();
    expect(result.roots.length).toBeGreaterThanOrEqual(2);
  });

  it('returns N/A when cash-flow signs are not mixed', () => {
    expect(solveXirr([{ date: '2025-01-01', amount: -100 }]).status).toBe('N/A');
  });

  it('evaluates XNPV consistently at the solved root', () => {
    const flows = [
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ];
    const result = solveXirr(flows);
    expect(Math.abs(xnpv(result.selectedRoot ?? 0, flows))).toBeLessThan(1e-6);
  });
});

describe('portfolio analysis', () => {
  it('reconciles simple economic P&L without historical prices', () => {
    const analysis = analyzePortfolio([trade()], snapshot);
    expect(analysis.mainValue).toBe(1100);
    expect(analysis.simpleEconomicPnl).toBe(100);
    expect(analysis.extendedInvestedValue).toBe(1200);
    expect(analysis.totalNetWorth).toBe(1500);
    expect(analysis.mainXirr.status).toBe('PASS');
  });
});
