import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('history UI regressions', () => {
  it('keeps SVG history series paths unfilled while retaining series colors for points', () => {
    const css = source('src/styles.css');
    expect(css).toMatch(/path\.history-series\s*\{[^}]*fill:\s*none;/s);
    expect(css).toMatch(/\.history-series-world\s*\{[^}]*fill:\s*#8fd8ae;/s);
    expect(css).toMatch(/\.history-series-sp500\s*\{[^}]*fill:\s*#f0c782;/s);
  });

  it('persists World and S&P 500 checkpoints sequentially', () => {
    const benchmarkUi = source('src/benchmark-ui.ts');
    const start = benchmarkUi.indexOf('const persisted = [');
    const end = benchmarkUi.indexOf('const statuses =', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const persistenceBlock = benchmarkUi.slice(start, end);
    expect(persistenceBlock).not.toContain('Promise.all');
    expect(persistenceBlock.match(/await persistCheckpoint\(/g)).toHaveLength(2);
  });
});
