// @ts-expect-error The project intentionally omits @types/node; Vitest still runs on Node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import benchmarkUi from '../src/benchmark-ui.ts?raw';
import overviewUi from '../src/overview-ui.ts?raw';
import packageJson from '../package.json';
import { APP_VERSION } from '../src/version';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

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

  it('keeps the visible application version aligned with package metadata', () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(overviewUi).toContain('APP_VERSION_LABEL');
  });
});
