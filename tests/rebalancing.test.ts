import { describe, expect, it } from 'vitest';
import type { NetWorthSnapshot } from '../src/domain';
import {
  computeRebalancing,
  createTargetConfig,
  mainPositionId,
  mainPositions,
  validateTargetConfig,
} from '../src/rebalancing';

function fixture(): NetWorthSnapshot {
  return {
    snapshotDate: '2026-09-05',
    generatedAt: null,
    summary: {
      compteTitres: 1000,
      pea: 4000,
      crypto: 1500,
      nonCote: 0,
      cash: 0,
      total: 6500,
    },
    positions: [
      { pocket: 'PEA', name: 'World', symbol: 'WORLD', shares: 1, price: 3000, value: 3000 },
      { pocket: 'PEA', name: 'Europe', symbol: 'EU', shares: 1, price: 1000, value: 1000 },
      { pocket: 'Compte-titres', name: 'Gold', symbol: 'GOLD', shares: 1, price: 1000, value: 1000 },
      { pocket: 'Crypto', name: 'Bitcoin', symbol: 'BTC', shares: 1, price: 1500, value: 1500 },
    ],
    warnings: [],
  };
}

function balancedConfig(snapshot = fixture()) {
  const positions = mainPositions(snapshot);
  return createTargetConfig(
    positions.map((position) => ({
      id: mainPositionId(position),
      targetWeight: position.value / 5000,
    })),
    '2026-09-05T12:00:00.000Z',
  );
}

describe('rebalancing targets', () => {
  it('requires targets to sum to 100%', () => {
    expect(() => createTargetConfig([
      { id: 'PEA:WORLD', targetWeight: 0.6 },
      { id: 'PEA:EU', targetWeight: 0.2 },
    ])).toThrow(/sum to 100%/);
  });

  it('rejects duplicate target ids', () => {
    expect(() => validateTargetConfig({
      schemaVersion: 1,
      savedAt: '2026-09-05T12:00:00.000Z',
      targets: [
        { id: 'PEA:WORLD', targetWeight: 0.5 },
        { id: 'PEA:WORLD', targetWeight: 0.5 },
      ],
    })).toThrow(/Duplicate/);
  });

  it('computes current minus target drift and target minus current EUR gap', () => {
    const snapshot = fixture();
    const config = createTargetConfig([
      { id: 'PEA:WORLD', targetWeight: 0.5 },
      { id: 'PEA:EU', targetWeight: 0.3 },
      { id: 'Compte-titres:GOLD', targetWeight: 0.2 },
    ], '2026-09-05T12:00:00.000Z');
    const result = computeRebalancing(snapshot, config);
    expect(result.status).toBe('PASS');
    const world = result.rows.find((row) => row.id === 'PEA:WORLD')!;
    expect(world.currentWeight).toBeCloseTo(0.6, 12);
    expect(world.driftWeight).toBeCloseTo(0.1, 12);
    expect(world.valueGap).toBeCloseTo(-500, 12);
    const europe = result.rows.find((row) => row.id === 'PEA:EU')!;
    expect(europe.valueGap).toBeCloseTo(500, 12);
    expect(result.internalReallocationEur).toBeCloseTo(500, 12);
  });

  it('invalidates saved targets when the current main position set changes', () => {
    const snapshot = fixture();
    const config = balancedConfig(snapshot);
    snapshot.positions.push({
      pocket: 'PEA', name: 'Emerging', symbol: 'EM', shares: 1, price: 100, value: 100,
    });
    snapshot.summary.pea += 100;
    snapshot.summary.total += 100;
    const result = computeRebalancing(snapshot, config);
    expect(result.status).toBe('INCOMPATIBLE');
    expect(result.missingTargetIds).toContain('PEA:EM');
  });

  it('does not compute drift when parsed positions do not reconcile with main value', () => {
    const snapshot = fixture();
    const config = balancedConfig(snapshot);
    snapshot.positions = snapshot.positions.filter((position) => position.symbol !== 'EU');
    const result = computeRebalancing(snapshot, config);
    expect(result.status).toBe('N/A');
    expect(result.rows).toEqual([]);
  });
});
