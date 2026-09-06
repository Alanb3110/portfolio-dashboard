export interface TradeRepublicSourcePair {
  csv: File;
  pdf: File;
}

export interface CsvSemanticCoverage {
  lastDate: string | null;
  rows: number;
}

export interface TradeRepublicSourceInspector {
  pdfSnapshotDate(file: File): Promise<string>;
  csvCoverage(file: File): Promise<CsvSemanticCoverage>;
}

export interface SemanticSourceSelection extends TradeRepublicSourcePair {
  pdfSnapshotDate: string;
  csvLastDate: string | null;
  warnings: string[];
}

const CSV_PATTERN = /^transaction export(?:\s*(?:\(\d+\)|\d+))?\.csv$/i;
const PDF_PATTERN = /^net worth(?:\s*(?:\(\d+\)|\d+))?\.pdf$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function compareFileMetadata(a: File, b: File): number {
  if (a.lastModified !== b.lastModified) return b.lastModified - a.lastModified;
  if (a.size !== b.size) return b.size - a.size;
  return b.name.localeCompare(a.name);
}

function newest(files: File[]): File | null {
  return [...files].sort(compareFileMetadata)[0] ?? null;
}

function matchingSources(files: readonly File[]): { csvFiles: File[]; pdfFiles: File[] } {
  const csvFiles = files.filter((file) => CSV_PATTERN.test(file.name));
  const pdfFiles = files.filter((file) => PDF_PATTERN.test(file.name));
  if (csvFiles.length === 0 || pdfFiles.length === 0) {
    const missing = [csvFiles.length === 0 ? 'Transaction export.csv' : null, pdfFiles.length === 0 ? 'Net Worth.pdf' : null]
      .filter(Boolean)
      .join(' + ');
    throw new Error(`Dossier incomplet : fichier(s) introuvable(s) — ${missing}.`);
  }
  return { csvFiles, pdfFiles };
}

export function selectLatestTradeRepublicSources(files: readonly File[]): TradeRepublicSourcePair {
  const { csvFiles, pdfFiles } = matchingSources(files);
  return { csv: newest(csvFiles)!, pdf: newest(pdfFiles)! };
}

function validIsoDate(value: string | null): boolean {
  if (value == null) return true;
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function selectLatestTradeRepublicSourcesByContent(
  files: readonly File[],
  inspector: TradeRepublicSourceInspector,
): Promise<SemanticSourceSelection> {
  const { csvFiles, pdfFiles } = matchingSources(files);
  const warnings: string[] = [];

  const inspectedPdfs: Array<{ file: File; snapshotDate: string }> = [];
  for (const file of pdfFiles) {
    try {
      const snapshotDate = await inspector.pdfSnapshotDate(file);
      if (!validIsoDate(snapshotDate)) throw new Error(`invalid snapshot date ${snapshotDate}`);
      inspectedPdfs.push({ file, snapshotDate });
    } catch (error) {
      warnings.push(`PDF ignoré (${file.name}) : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (inspectedPdfs.length === 0) throw new Error('Aucun Net Worth PDF du dossier ne peut être validé.');
  inspectedPdfs.sort((a, b) => {
    const date = b.snapshotDate.localeCompare(a.snapshotDate);
    return date !== 0 ? date : compareFileMetadata(a.file, b.file);
  });

  const inspectedCsvs: Array<{ file: File; coverage: CsvSemanticCoverage }> = [];
  for (const file of csvFiles) {
    try {
      const coverage = await inspector.csvCoverage(file);
      if (!Number.isInteger(coverage.rows) || coverage.rows < 0) throw new Error('invalid row count');
      if (!validIsoDate(coverage.lastDate)) throw new Error(`invalid last transaction date ${coverage.lastDate}`);
      inspectedCsvs.push({ file, coverage });
    } catch (error) {
      warnings.push(`CSV ignoré (${file.name}) : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (inspectedCsvs.length === 0) throw new Error('Aucun Transaction export CSV du dossier ne peut être validé.');
  inspectedCsvs.sort((a, b) => {
    const aDate = a.coverage.lastDate ?? '';
    const bDate = b.coverage.lastDate ?? '';
    const date = bDate.localeCompare(aDate);
    if (date !== 0) return date;
    if (a.coverage.rows !== b.coverage.rows) return b.coverage.rows - a.coverage.rows;
    return compareFileMetadata(a.file, b.file);
  });

  const pdf = inspectedPdfs[0]!;
  const csv = inspectedCsvs[0]!;
  return {
    pdf: pdf.file,
    csv: csv.file,
    pdfSnapshotDate: pdf.snapshotDate,
    csvLastDate: csv.coverage.lastDate,
    warnings,
  };
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sourcePairFingerprint(pair: TradeRepublicSourcePair): Promise<string> {
  const [csvHash, pdfHash] = await Promise.all([sha256(pair.csv), sha256(pair.pdf)]);
  return `${csvHash}:${pdfHash}`;
}
