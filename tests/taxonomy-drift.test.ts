import { describe, expect, it } from 'vitest';
import type { TradeRepublicTransaction } from '../src/domain';
import { auditLedger, normalizeLedger } from '../src/trade-republic';

function transaction(overrides: Partial<TradeRepublicTransaction> = {}): TradeRepublicTransaction {
  return {
    datetime: '2026-09-05T10:00:00.000Z',
    date: '2026-09-05',
    accountType: 'DEFAULT',
    category: 'TRADING',
    type: 'BUY',
    assetClass: 'FUND',
    name: 'Synthetic fund',
    symbol: 'TEST',
    shares: 1,
    price: 100,
    amount: -100,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    description: null,
    transactionId: 'tx-1',
    ...overrides,
  };
}

describe('Trade Republic taxonomy drift', () => {
  it('accepts the currently mapped main-investment taxonomy', () => {
    const rows = normalizeLedger([
      transaction(),
      transaction({
        datetime: '2026-09-05T11:00:00.000Z',
        category: 'CASH',
        type: 'DIVIDEND',
        shares: null,
        price: null,
        amount: 5,
        transactionId: 'tx-2',
      }),
    ]);
    expect(() => auditLedger(rows)).not.toThrow();
  });

  it('fails visibly when a new main-investment type could alter performance mapping', () => {
    const rows = normalizeLedger([
      transaction({
        category: 'CASH',
        type: 'CASH_DISTRIBUTION',
        shares: null,
        price: null,
        amount: 5,
      }),
    ]);
    expect(() => auditLedger(rows)).toThrow(/unknown main-investment type/i);
  });

  it('does not block an unrelated new cash-only type', () => {
    const rows = normalizeLedger([
      transaction({
        category: 'CASH',
        type: 'NEW_CARD_REWARD',
        assetClass: null,
        name: null,
        symbol: null,
        shares: null,
        price: null,
        amount: 1,
      }),
    ]);
    expect(() => auditLedger(rows)).not.toThrow();
  });

  it('fails on an unknown account type because scope classification becomes ambiguous', () => {
    const rows = normalizeLedger([transaction({ accountType: 'NEW_INVESTMENT_ACCOUNT' })]);
    expect(() => auditLedger(rows)).toThrow(/unknown account_type/i);
  });

  it('fails on an unknown asset class before silently assigning it to cash', () => {
    const rows = normalizeLedger([transaction({ assetClass: 'NEW_SECURITY_CLASS' })]);
    expect(() => auditLedger(rows)).toThrow(/unknown asset_class/i);
  });
});
