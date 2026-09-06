/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import mainSource from '../src/main.ts?raw';

describe('refresh orchestration', () => {
  it('does not release the analysis busy state from inside runAnalysis', () => {
    const runAnalysis = mainSource.match(/async function runAnalysis[\s\S]*?\n}\n\nfolderRefreshButton/);
    expect(runAnalysis?.[0]).toBeTruthy();
    expect(runAnalysis?.[0]).not.toContain('setAnalysisBusy(');
  });

  it('persists folder refresh without forcing a second analysis render', () => {
    expect(mainSource).toContain('persistCurrentSnapshot(false)');
    expect(mainSource).toContain('if (rerender) rerenderCurrentAnalysis();');
  });
});
