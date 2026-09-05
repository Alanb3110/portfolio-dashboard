import { describe, expect, it } from 'vitest';
import { buildAllocationView, concentrationCoverageReliable } from '../src/allocation';
import type { NetWorthSnapshot } from '../src/domain';

function fixture(): NetWorthSnapshot {
  return {
    snapshotDate: '2026-09-05',
    generatedAt: null,
    summary: {
      compteTitres: 1000,
      pea: 4000,
      crypto: 1500,
      nonCote: 200,
      cash: 300,
      total: 7000,
    },
    positions: [
      { pocket: 'PEA', name: 'World', symbol: 'WORLD', shares: 1, price: 2500, value: 2500 },
      { pocket: 'PEA', name: 'Europe', symbol: 'EU', shares: 1, price: 1000, value: 1000 },
      { pocket: 'PEA', name: 'EM', symbol: 'EM', shares: 1, price: 500, value: 500 },
      { pocket: 'Compte-titres', name: 'Gold', symbol: 'GOLD', shares: 1, price: 600, value: 600 },
      { pocket: 'Compte-titres', name: 'Space', symbol: 'SPACE', shares: 1, price: 400, value: 400 },
      { pocket: 'Crypto', name: 'Bitcoin', symbol: 'BTC', shares: 1, price: 1200, value: 1200 },
      { pocket: 'Crypto', name: 'Solana', symbol: 'SOL', shares: 1, price: 300, value: 300 },
    ],
    warnings: [],
  };
}

describe('allocation views', () => {
  it('keeps the main scope to Compte-titres + PEA', () => {
    const view = buildAllocationView(fixture(), 'main');
    expect(view.officialValue).toBe(5000);
    expect(view.positions.map((position) => position.pocket)).not.toContain('Crypto');
    expect(view.parsedPositionValue).toBe(5000);
  });

  it('keeps crypto in its own view', () => {
    const view = buildAllocationView(fixture(), 'crypto');
    expect(view.officialValue).toBe(1500);
    expect(view.positions).toHaveLength(2);
    expect(view.positions.every((position) => position.pocket === 'Crypto')).toBe(true);
  });

  it('computes top concentration against the official pocket value', () => {
    const view = buildAllocationView(fixture(), 'pea');
    expect(view.top1Weight).toBeCloseTo(0.625, 12);
    expect(view.top3Weight).toBeCloseTo(1, 12);
  });

  it('computes HHI and equal-weight equivalent position count', () => {
    const view = buildAllocationView(fixture(), 'ct');
    expect(view.hhi).toBeCloseTo(0.52, 12);
    expect(view.effectivePositionCount).toBeCloseTo(1 / 0.52, 12);
  });

  it('flags incomplete position coverage instead of treating concentration as reliable', () => {
    const snapshot = fixture();
    snapshot.positions = snapshot.positions.filter((position) => position.symbol !== 'EM');
    const view = buildAllocationView(snapshot, 'pea');
    expect(view.coverageRatio).toBeCloseTo(0.875, 12);
    expect(concentrationCoverageReliable(view)).toBe(false);
  });
});
