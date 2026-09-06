import { describe, expect, it } from 'vitest';
import { selectSingleTradeRepublicSources } from '../src/source-refresh';

function fakeFile(name: string): File {
  return {
    name,
    lastModified: 0,
    size: 0,
  } as unknown as File;
}

describe('folder source refresh', () => {
  it('accepts exactly one matching PDF and CSV for the iPhone folder workflow', () => {
    const pair = selectSingleTradeRepublicSources([
      fakeFile('Net Worth.pdf'),
      fakeFile('Transaction export.csv'),
      fakeFile('notes.txt'),
    ]);

    expect(pair.pdf.name).toBe('Net Worth.pdf');
    expect(pair.csv.name).toBe('Transaction export.csv');
  });

  it('accepts Trade Republic suffixed export names when they are unambiguous', () => {
    const pair = selectSingleTradeRepublicSources([
      fakeFile('Net Worth (5).pdf'),
      fakeFile('Transaction export(5).csv'),
    ]);

    expect(pair.pdf.name).toBe('Net Worth (5).pdf');
    expect(pair.csv.name).toBe('Transaction export(5).csv');
  });

  it('rejects ambiguous folder contents instead of comparing several exports', () => {
    expect(() => selectSingleTradeRepublicSources([
      fakeFile('Net Worth.pdf'),
      fakeFile('Net Worth (2).pdf'),
      fakeFile('Transaction export.csv'),
    ])).toThrow(/Plusieurs exports Trade Republic détectés/);

    expect(() => selectSingleTradeRepublicSources([
      fakeFile('Net Worth.pdf'),
      fakeFile('Transaction export.csv'),
      fakeFile('Transaction export (2).csv'),
    ])).toThrow(/import manuel/);
  });

  it('fails clearly when a required source is absent', () => {
    expect(() => selectSingleTradeRepublicSources([
      fakeFile('Net Worth.pdf'),
    ])).toThrow(/Transaction export\.csv/);

    expect(() => selectSingleTradeRepublicSources([
      fakeFile('Transaction export.csv'),
    ])).toThrow(/Net Worth\.pdf/);
  });
});
