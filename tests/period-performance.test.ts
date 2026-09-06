import { describe, expect, it } from 'vitest';
import { computePeriodPerformance } from '../src/period-performance';

describe('snapshot-to-snapshot period performance', () => {
  it('separates a contribution from economic performance', () => {
    const result = computePeriodPerformance(
      '2026-01-01',
      5000,
      '2026-02-01',
      6100,
      [{ date: '2026-01-15', amount: -1000 }],
    );

    expect(result.rawValueDelta).toBe(1100);
    expect(result.netContributionEur).toBe(1000);
    expect(result.economicPnl).toBe(100);
    expect(result.canonicalCashflowSum).toBe(-1000);
    expect(result.days).toBe(31);
  });

  it('treats a sale or distribution as money leaving the main holdings scope', () => {
    const result = computePeriodPerformance(
      '2026-01-01',
      5000,
      '2026-02-01',
      4600,
      [{ date: '2026-01-20', amount: 500 }],
    );

    expect(result.rawValueDelta).toBe(-400);
    expect(result.netContributionEur).toBe(-500);
    expect(result.economicPnl).toBe(100);
  });

  it('ignores flows outside the open-start/closed-end snapshot interval', () => {
    const result = computePeriodPerformance(
      '2026-01-10',
      1000,
      '2026-02-10',
      1100,
      [
        { date: '2026-01-10', amount: -400 },
        { date: '2026-01-20', amount: -100 },
        { date: '2026-02-10', amount: 20 },
        { date: '2026-02-11', amount: -500 },
      ],
    );

    expect(result.canonicalCashflowSum).toBe(-80);
    expect(result.netContributionEur).toBe(80);
    expect(result.economicPnl).toBe(20);
  });

  it('uses the existing frozen forward XIRR convention', () => {
    const result = computePeriodPerformance(
      '2025-01-01',
      1000,
      '2026-01-01',
      1100,
      [],
    );

    expect(result.xirr.status).toBe('PASS');
    expect(result.xirr.selectedRoot ?? 0).toBeCloseTo(0.1, 8);
  });

  it('rejects a non-positive snapshot interval', () => {
    expect(() => computePeriodPerformance('2026-01-01', 1000, '2026-01-01', 1000, [])).toThrow(/Invalid snapshot period/);
  });
});
