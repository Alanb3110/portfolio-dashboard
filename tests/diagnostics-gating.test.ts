/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import diagnosticsSource from '../src/diagnostics.ts?raw';

describe('runtime diagnostics gating', () => {
  it('keeps verbose diagnostics opt-in instead of always-on', () => {
    expect(diagnosticsSource).toContain("get('diagnostics') === '1'");
    expect(diagnosticsSource).toContain('if (!DIAGNOSTICS_ENABLED) return;');
    expect(diagnosticsSource).toContain('!DIAGNOSTICS_ENABLED ||');
  });
});
