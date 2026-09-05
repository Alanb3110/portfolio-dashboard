import { describe, expect, it } from 'vitest';
import { selectLatestTradeRepublicSources, sourcePairFingerprint } from '../src/source-refresh';

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
  it('selects the newest Trade Republic PDF and CSV independently', () => {
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
