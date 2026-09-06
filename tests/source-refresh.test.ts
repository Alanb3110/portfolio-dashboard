import { describe, expect, it } from 'vitest';
import {
  selectLatestTradeRepublicSources,
  selectLatestTradeRepublicSourcesByContent,
  sourcePairFingerprint,
} from '../src/source-refresh';

function fakeFile(name: string, lastModified: number, content: string): File {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    lastModified,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

describe('folder source refresh', () => {
  it('keeps metadata-only selection as a deterministic fallback', () => {
    const pair = selectLatestTradeRepublicSources([
      fakeFile('Net Worth.pdf', 100, 'old-pdf'),
      fakeFile('Net Worth (2).pdf', 300, 'new-pdf'),
      fakeFile('Transaction export.csv', 150, 'old-csv'),
      fakeFile('Transaction export (5).csv', 400, 'new-csv'),
      fakeFile('portfolio-dashboard-backup.json', 500, 'ignore-me'),
    ]);

    expect(pair.pdf.name).toBe('Net Worth (2).pdf');
    expect(pair.csv.name).toBe('Transaction export (5).csv');
  });

  it('prefers the newest PDF snapshot date over a later filesystem timestamp', async () => {
    const oldRedownload = fakeFile('Net Worth (9).pdf', 900, 'old-redownload');
    const current = fakeFile('Net Worth (8).pdf', 800, 'current');
    const csv = fakeFile('Transaction export.csv', 700, 'csv');
    const dates = new Map<File, string>([
      [oldRedownload, '2026-08-20'],
      [current, '2026-08-27'],
    ]);

    const selection = await selectLatestTradeRepublicSourcesByContent(
      [oldRedownload, current, csv],
      {
        pdfSnapshotDate: async (file) => dates.get(file)!,
        csvCoverage: async () => ({ lastDate: '2026-08-27', rows: 100 }),
      },
    );

    expect(selection.pdf).toBe(current);
    expect(selection.pdfSnapshotDate).toBe('2026-08-27');
  });

  it('prefers the CSV with the newest transaction coverage, then the most rows', async () => {
    const pdf = fakeFile('Net Worth.pdf', 500, 'pdf');
    const staleRedownload = fakeFile('Transaction export (9).csv', 900, 'stale');
    const currentShort = fakeFile('Transaction export (8).csv', 800, 'current-short');
    const currentFull = fakeFile('Transaction export (7).csv', 700, 'current-full');
    const coverage = new Map<File, { lastDate: string | null; rows: number }>([
      [staleRedownload, { lastDate: '2026-08-20', rows: 120 }],
      [currentShort, { lastDate: '2026-08-27', rows: 90 }],
      [currentFull, { lastDate: '2026-08-27', rows: 130 }],
    ]);

    const selection = await selectLatestTradeRepublicSourcesByContent(
      [pdf, staleRedownload, currentShort, currentFull],
      {
        pdfSnapshotDate: async () => '2026-08-27',
        csvCoverage: async (file) => coverage.get(file)!,
      },
    );

    expect(selection.csv).toBe(currentFull);
    expect(selection.csvLastDate).toBe('2026-08-27');
  });

  it('reports matching but unreadable old exports without letting them win', async () => {
    const goodPdf = fakeFile('Net Worth.pdf', 100, 'good');
    const brokenPdf = fakeFile('Net Worth (2).pdf', 200, 'broken');
    const csv = fakeFile('Transaction export.csv', 300, 'csv');

    const selection = await selectLatestTradeRepublicSourcesByContent(
      [goodPdf, brokenPdf, csv],
      {
        pdfSnapshotDate: async (file) => {
          if (file === brokenPdf) throw new Error('cannot parse');
          return '2026-08-27';
        },
        csvCoverage: async () => ({ lastDate: '2026-08-27', rows: 10 }),
      },
    );

    expect(selection.pdf).toBe(goodPdf);
    expect(selection.warnings).toHaveLength(1);
    expect(selection.warnings[0]).toMatch(/Net Worth \(2\)\.pdf/);
  });

  it('fails clearly when a required source is absent', () => {
    expect(() => selectLatestTradeRepublicSources([
      fakeFile('Net Worth.pdf', 100, 'pdf'),
    ])).toThrow(/Transaction export\.csv/);
  });

  it('fingerprints file contents rather than file names', async () => {
    const a = await sourcePairFingerprint({
      csv: fakeFile('Transaction export.csv', 100, 'same-csv'),
      pdf: fakeFile('Net Worth.pdf', 100, 'same-pdf'),
    });
    const b = await sourcePairFingerprint({
      csv: fakeFile('Transaction export (8).csv', 200, 'same-csv'),
      pdf: fakeFile('Net Worth (8).pdf', 200, 'same-pdf'),
    });
    const c = await sourcePairFingerprint({
      csv: fakeFile('Transaction export.csv', 100, 'changed-csv'),
      pdf: fakeFile('Net Worth.pdf', 100, 'same-pdf'),
    });

    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
