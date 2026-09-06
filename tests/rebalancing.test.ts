import { describe, expect, it } from 'vitest';
import type { NetWorthSnapshot } from '../src/domain';
import {
  computeContributionRebalancing,
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

function steeringConfig() {
  return createTargetConfig([
    { id: 'PEA:WORLD', targetWeight: 0.5 },
    { id: 'PEA:EU', targetWeight: 0.3 },
    { id: 'Compte-titres:GOLD', targetWeight: 0.2 },
  ], '2026-09-05T12:00:00.000Z');
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
    const config = steeringConfig();
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

describe('buy-only contribution steering', () => {
  it('uses an exactly sufficient contribution to reach targets without sales', () => {
    const result = computeContributionRebalancing(fixture(), steeringConfig(), 1000);
    expect(result.status).toBe('PASS');
    expect(result.projectedMainValue).toBe(6000);

    const world = result.rows.find((row) => row.id === 'PEA:WORLD')!;
    const europe = result.rows.find((row) => row.id === 'PEA:EU')!;
    const gold = result.rows.find((row) => row.id === 'Compte-titres:GOLD')!;
    expect(world.purchaseEur).toBeCloseTo(0, 10);
    expect(europe.purchaseEur).toBeCloseTo(800, 10);
    expect(gold.purchaseEur).toBeCloseTo(200, 10);
    expect(europe.projectedWeight).toBeCloseTo(0.3, 10);
    expect(gold.projectedWeight).toBeCloseTo(0.2, 10);
    expect(result.maxProjectedAbsDrift).toBeCloseTo(0, 10);
  });

  it('allocates an insufficient contribution proportionally across positive projected deficits', () => {
    const result = computeContributionRebalancing(fixture(), steeringConfig(), 500);
    expect(result.status).toBe('PASS');

    const world = result.rows.find((row) => row.id === 'PEA:WORLD')!;
    const europe = result.rows.find((row) => row.id === 'PEA:EU')!;
    const gold = result.rows.find((row) => row.id === 'Compte-titres:GOLD')!;
    expect(world.purchaseEur).toBeCloseTo(0, 10);
    expect(europe.purchaseEur).toBeCloseTo(650 * (500 / 750), 10);
    expect(gold.purchaseEur).toBeCloseTo(100 * (500 / 750), 10);
    expect(result.rows.reduce((sum, row) => sum + row.purchaseEur, 0)).toBeCloseTo(500, 8);
    expect(result.maxCurrentAbsDrift).toBeCloseTo(0.1, 10);
    expect(result.maxProjectedAbsDrift ?? 1).toBeLessThan(result.maxCurrentAbsDrift ?? 0);
  });

  it('never assigns a negative purchase', () => {
    const result = computeContributionRebalancing(fixture(), steeringConfig(), 250);
    expect(result.status).toBe('PASS');
    expect(result.rows.every((row) => row.purchaseEur >= 0)).toBe(true);
  });

  it('rejects a negative contribution', () => {
    const result = computeContributionRebalancing(fixture(), steeringConfig(), -1);
    expect(result.status).toBe('N/A');
    expect(result.rows).toEqual([]);
  });

  it('propagates incompatible target sets instead of inventing guidance', () => {
    const snapshot = fixture();
    const config = balancedConfig(snapshot);
    snapshot.positions.push({ pocket: 'PEA', name: 'Emerging', symbol: 'EM', shares: 1, price: 100, value: 100 });
    snapshot.summary.pea += 100;
    snapshot.summary.total += 100;
    const result = computeContributionRebalancing(snapshot, config, 500);
    expect(result.status).toBe('INCOMPATIBLE');
    expect(result.rows).toEqual([]);
  });
});
