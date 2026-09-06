export interface TradeRepublicSourcePair {
  csv: File;
  pdf: File;
}

const CSV_PATTERN = /^transaction export(?:\s*(?:\(\d+\)|\d+))?\.csv$/i;
const PDF_PATTERN = /^net worth(?:\s*(?:\(\d+\)|\d+))?\.pdf$/i;

function matchingSources(files: readonly File[]): { csvFiles: File[]; pdfFiles: File[] } {
  const csvFiles = files.filter((file) => CSV_PATTERN.test(file.name));
  const pdfFiles = files.filter((file) => PDF_PATTERN.test(file.name));

  if (csvFiles.length === 0 || pdfFiles.length === 0) {
    const missing = [
      csvFiles.length === 0 ? 'Transaction export.csv' : null,
      pdfFiles.length === 0 ? 'Net Worth.pdf' : null,
    ]
      .filter(Boolean)
      .join(' + ');
    throw new Error(`Dossier incomplet : fichier(s) introuvable(s) — ${missing}.`);
  }

  return { csvFiles, pdfFiles };
}

/**
 * iPhone-first folder workflow: the dedicated import folder must contain
 * exactly one current Trade Republic CSV and one current Net Worth PDF.
 * Ambiguity is deliberately rejected instead of opening/parsing several files.
 */
export function selectSingleTradeRepublicSources(files: readonly File[]): TradeRepublicSourcePair {
  const { csvFiles, pdfFiles } = matchingSources(files);
  if (csvFiles.length !== 1 || pdfFiles.length !== 1) {
    throw new Error(
      `Plusieurs exports Trade Republic détectés (${pdfFiles.length} Net Worth PDF, ${csvFiles.length} Transaction CSV). ` +
      'Sélection automatique désactivée : utilise « Sources et import manuel » ou remplace les anciens exports dans le dossier.',
    );
  }

  return { csv: csvFiles[0]!, pdf: pdfFiles[0]! };
}
