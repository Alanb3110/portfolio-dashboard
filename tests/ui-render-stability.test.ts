import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('UI render stability', () => {
  it('does not use results-container mutations as an allocation render trigger', async () => {
    const allocationUi = await source('../src/allocation-ui.ts');

    expect(allocationUi).toContain('subscribeUiSnapshot');
    expect(allocationUi).not.toMatch(/\.observe\(results\s*,/);
  });

  it('does not use results-container mutations as a rebalancing render trigger', async () => {
    const rebalancingUi = await source('../src/rebalancing-ui.ts');

    expect(rebalancingUi).toContain('subscribeUiSnapshot');
    expect(rebalancingUi).not.toMatch(/\.observe\(results\s*,/);
  });
});
