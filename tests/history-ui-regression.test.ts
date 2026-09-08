import { describe, expect, it } from 'vitest';
import styles from '../src/styles.css?raw';
import benchmarkUi from '../src/benchmark-ui.ts?raw';

describe('history UI regressions', () => {
  it('keeps SVG history series paths unfilled while retaining series colors for points', () => {
    expect(styles).toMatch(/path\.history-series\s*\{[^}]*fill:\s*none;/s);
    expect(styles).toMatch(/\.history-series-world\s*\{[^}]*fill:\s*#8fd8ae;/s);
    expect(styles).toMatch(/\.history-series-sp500\s*\{[^}]*fill:\s*#f0c782;/s);
  });

  it('persists World and S&P 500 checkpoints sequentially', () => {
    const start = benchmarkUi.indexOf('const persisted = [');
    const end = benchmarkUi.indexOf('const statuses =', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const persistenceBlock = benchmarkUi.slice(start, end);
    expect(persistenceBlock).not.toContain('Promise.all');
    expect(persistenceBlock.match(/await persistCheckpoint\(/g)).toHaveLength(2);
  });
});
