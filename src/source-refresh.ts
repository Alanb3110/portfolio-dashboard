export interface TradeRepublicSourcePair {
  csv: File;
  pdf: File;
}

const CSV_PATTERN = /^transaction export(?:\s*(?:\(\d+\)|\d+))?\.csv$/i;
const PDF_PATTERN = /^net worth(?:\s*(?:\(\d+\)|\d+))?\.pdf$/i;

function newest(files: File[]): File | null {
  return [...files].sort((a, b) => {
    if (a.lastModified !== b.lastModified) return b.lastModified - a.lastModified;
    if (a.size !== b.size) return b.size - a.size;
    return b.name.localeCompare(a.name);
  })[0] ?? null;
}

export function selectLatestTradeRepublicSources(files: readonly File[]): TradeRepublicSourcePair {
  const csv = newest(files.filter((file) => CSV_PATTERN.test(file.name)));
  const pdf = newest(files.filter((file) => PDF_PATTERN.test(file.name)));

  if (!csv || !pdf) {
    const missing = [!csv ? 'Transaction export.csv' : null, !pdf ? 'Net Worth.pdf' : null]
      .filter(Boolean)
      .join(' + ');
    throw new Error(`Dossier incomplet : fichier(s) introuvable(s) — ${missing}.`);
  }

  return { csv, pdf };
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sourcePairFingerprint(pair: TradeRepublicSourcePair): Promise<string> {
  const [csvHash, pdfHash] = await Promise.all([sha256(pair.csv), sha256(pair.pdf)]);
  return `${csvHash}:${pdfHash}`;
}
