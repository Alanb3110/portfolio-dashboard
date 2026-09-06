/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import allocationUi from '../src/allocation-ui.ts?raw';
import rebalancingUi from '../src/rebalancing-ui.ts?raw';

describe('UI render stability', () => {
  it('does not use results-container mutations as an allocation render trigger', () => {
    expect(allocationUi).toContain('subscribeUiSnapshot');
    expect(allocationUi).not.toMatch(/\.observe\(results\s*,/);
  });

  it('does not use results-container mutations as a rebalancing render trigger', () => {
    expect(rebalancingUi).toContain('subscribeUiSnapshot');
    expect(rebalancingUi).not.toMatch(/\.observe\(results\s*,/);
  });
});
