import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { diagFile, diagLog } from './diagnostics';
import type { NetWorthSnapshot, NetWorthSummary, PositionPocket, SnapshotPosition } from './domain';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_STAGE_TIMEOUT_MS = 15_000;

function reportPdfStage(message: string): void {
  diagLog(`PDF stage: ${message}`);
  if (typeof document === 'undefined') return;
  const status = document.querySelector<HTMLElement>('.quick-status') ?? document.querySelector<HTMLElement>('.status');
  if (status) status.textContent = message;
}

async function withPdfTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const startedAt = performance.now();
  diagLog(`PDF await START: ${label}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          diagLog(`PDF await TIMEOUT: ${label} après ${PDF_STAGE_TIMEOUT_MS} ms`);
          reject(new Error(`Délai PDF dépassé pendant ${label} (${PDF_STAGE_TIMEOUT_MS / 1000} s).`));
        }, PDF_STAGE_TIMEOUT_MS);
      }),
    ]);
    diagLog(`PDF await OK: ${label} en ${(performance.now() - startedAt).toFixed(1)} ms`);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    diagLog(`PDF await ERROR: ${label} après ${(performance.now() - startedAt).toFixed(1)} ms · ${detail}`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readPdfBytesWithFileReader(file: File): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    let lastProgress = -1;

    diagLog(`PDF FileReader créé · readyState=${reader.readyState}`);

    reader.onloadstart = () => {
      diagLog(`PDF FileReader loadstart · readyState=${reader.readyState}`);
    };
    reader.onprogress = (event) => {
      const loaded = event.loaded;
      const total = event.lengthComputable ? event.total : file.size;
      const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
      if (percent !== lastProgress) {
        lastProgress = percent;
        diagLog(`PDF FileReader progress · ${loaded}/${total} B · ${percent}%`);
      }
    };
    reader.onerror = () => {
      const detail = reader.error ? `${reader.error.name}: ${reader.error.message}` : 'erreur inconnue';
      diagLog(`PDF FileReader error · ${detail}`);
      reject(reader.error ?? new Error('FileReader PDF error'));
    };
    reader.onabort = () => {
      diagLog('PDF FileReader abort');
      reject(new Error('Lecture PDF annulée par FileReader.'));
    };
    reader.onload = () => {
      const result = reader.result;
      diagLog(`PDF FileReader load · readyState=${reader.readyState} · resultType=${result?.constructor?.name ?? typeof result}`);
      if (!(result instanceof ArrayBuffer)) {
        reject(new Error('FileReader PDF did not return an ArrayBuffer.'));
        return;
      }
      resolve(result);
    };
    reader.onloadend = () => {
      diagLog(`PDF FileReader loadend · readyState=${reader.readyState}`);
    };

    try {
      diagLog('PDF FileReader readAsArrayBuffer() CALL');
      reader.readAsArrayBuffer(file);
      diagLog(`PDF FileReader readAsArrayBuffer() RETURN · readyState=${reader.readyState}`);
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      diagLog(`PDF FileReader readAsArrayBuffer() THROW · ${detail}`);
      reject(error);
    }
  });
}

function parseFrenchNumber(raw: string): number {
  const compact = raw.replace(/[\s\u00a0]/g, '');
  let normalized = compact;
  if (compact.includes(',') && compact.includes('.')) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (compact.includes(',')) {
    normalized = compact.replace(',', '.');
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric value in Net Worth PDF: ${raw}`);
  return value;
}

interface PositionedText {
  x: number;
  y: number;
  text: string;
}

async function extractLayoutText(file: File): Promise<string> {
  diagFile('PDF entrée', file);
  reportPdfStage(`PDF 1/8 · Métadonnées ${file.name} · ${file.size} octets…`);

  reportPdfStage(`PDF 2/8 · FileReader des octets ${file.name}…`);
  const buffer = await withPdfTimeout(readPdfBytesWithFileReader(file), 'la lecture FileReader des octets du fichier');
  const bytes = new Uint8Array(buffer);
  const signature = [...bytes.slice(0, 8)].map((value) => value.toString(16).padStart(2, '0')).join(' ');
  diagLog(`PDF octets disponibles · byteLength=${bytes.byteLength} · signatureHex=${signature}`);

  const fakeWorker = Boolean(
    (globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler?: unknown } }).pdfjsWorker?.WorkerMessageHandler,
  );
  reportPdfStage(`PDF 3/8 · ${Math.ceil(bytes.byteLength / 1024)} ko chargés · Initialisation PDF.js…`);
  diagLog(`PDF.js config · workerSrc=${GlobalWorkerOptions.workerSrc} · fakeWorkerPreloaded=${fakeWorker}`);

  diagLog('PDF getDocument() CALL');
  const loadingTask = getDocument({ data: bytes });
  diagLog('PDF getDocument() RETURN · attente loadingTask.promise');
  const pdfDocument = await withPdfTimeout(loadingTask.promise, 'l’initialisation PDF.js / ouverture du document');
  reportPdfStage(`PDF 4/8 · Document ouvert · ${pdfDocument.numPages} page(s)…`);

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    reportPdfStage(`PDF 5/8 · getPage ${pageNumber}/${pdfDocument.numPages}…`);
    const page = await withPdfTimeout(pdfDocument.getPage(pageNumber), `getPage(${pageNumber})`);
    diagLog(`PDF getPage(${pageNumber}) OK`);

    reportPdfStage(`PDF 6/8 · getTextContent page ${pageNumber}/${pdfDocument.numPages}…`);
    diagLog(`PDF page ${pageNumber}: getTextContent() CALL`);
    const content = await withPdfTimeout(page.getTextContent(), `getTextContent() page ${pageNumber}`);
    diagLog(`PDF page ${pageNumber}: getTextContent() OK · items=${content.items.length}`);

    reportPdfStage(`PDF 7/8 · Reconstruction layout page ${pageNumber}/${pdfDocument.numPages}…`);
    const items: PositionedText[] = [];

    for (const item of content.items) {
      if (!('str' in item) || !('transform' in item)) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      items.push({ x, y, text: item.str });
    }
    diagLog(`PDF page ${pageNumber}: ${items.length} item(s) texte positionnés`);

    const lines = new Map<number, PositionedText[]>();
    for (const item of items) {
      const y = Math.round(item.y * 2) / 2;
      const line = lines.get(y) ?? [];
      line.push(item);
      lines.set(y, line);
    }

    const pageLines = [...lines.entries()]
      .sort(([a], [b]) => b - a)
      .map(([, line]) =>
        line
          .sort((a, b) => a.x - b.x)
          .map((item) => item.text.trim())
          .filter(Boolean)
          .join(' '),
      )
      .filter(Boolean);

    pages.push(pageLines.join('\n'));
    diagLog(`PDF page ${pageNumber}: reconstruction OK · lignes=${pageLines.length}`);
  }

  reportPdfStage('PDF 8/8 · Texte extrait · Interprétation du relevé…');
  return pages.join('\n');
}

function extractSummaryBlock(text: string): string {
  const headingIndex = text.search(/ÉTAT DU PATRIMOINE NET/i);
  if (headingIndex < 0) throw new Error('Missing ÉTAT DU PATRIMOINE NET section in Net Worth PDF.');

  const fromHeading = text.slice(headingIndex);
  const totalMatch = fromHeading.match(/^TOTAL\s+[\d.,]+(?:\s+EUR)?\s*$/mi);
  if (!totalMatch || totalMatch.index == null) {
    throw new Error('Could not delimit the Net Worth summary table.');
  }

  return fromHeading.slice(0, totalMatch.index + totalMatch[0].length);
}

function summaryValue(summaryBlock: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = summaryBlock.match(new RegExp(`^${escaped}\\s+([\\d.,]+)(?:\\s+EUR)?\\s*$`, 'mi'));
  if (!match?.[1]) throw new Error(`Missing Net Worth summary field: ${label}`);
  return parseFrenchNumber(match[1]);
}

function parsePositions(lines: string[]): SnapshotPosition[] {
  let section: PositionPocket | null = null;
  let pending: SnapshotPosition | null = null;
  const positions: SnapshotPosition[] = [];

  const flush = (): void => {
    if (pending) positions.push(pending);
    pending = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'COMPTE-TITRES') {
      flush();
      section = 'Compte-titres';
      continue;
    }
    if (line === 'NON COTÉ') {
      flush();
      section = 'Non cote';
      continue;
    }
    if (line === 'PORTEFEUILLE CRYPTO') {
      flush();
      section = 'Crypto';
      continue;
    }
    if (line === "PLAN D'ÉPARGNE EN ACTIONS") {
      flush();
      section = 'PEA';
      continue;
    }
    if (line === 'ESPÈCES') {
      flush();
      section = null;
      continue;
    }

    if (section) {
      const row = line.match(/^([\d.,]+)\s+Pièces\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)$/i);
      if (row?.[1] && row[2] && row[3] && row[4]) {
        flush();
        pending = {
          pocket: section,
          shares: parseFrenchNumber(row[1]),
          name: row[2].trim(),
          price: parseFrenchNumber(row[3]),
          value: parseFrenchNumber(row[4]),
          symbol: null,
        };
        continue;
      }
    }

    if (pending) {
      const isin = line.match(/ISIN:\s*([A-Z0-9]+)/i);
      if (isin?.[1]) {
        pending.symbol = isin[1].toUpperCase();
        continue;
      }

      if (pending.pocket === 'Crypto' && pending.symbol == null) {
        const ticker = line.match(/^([A-Z0-9]{2,12})(?:\s+\d{2}\.\d{2}\.\d{4})?$/);
        if (ticker?.[1]) {
          pending.symbol = ticker[1];
          continue;
        }
      }

      if (line.startsWith('NOMBRE DE POSITIONS')) flush();
    }
  }

  flush();
  return positions;
}

export function parseNetWorthText(text: string): NetWorthSnapshot {
  diagLog(`PDF parseNetWorthText START · caractères=${text.length}`);
  const snapshotMatch = text.match(/au\s+(\d{2})\.(\d{2})\.(\d{4})/i);
  if (!snapshotMatch?.[1] || !snapshotMatch[2] || !snapshotMatch[3]) {
    throw new Error('Could not find the snapshot date in the Net Worth PDF.');
  }

  const summaryBlock = extractSummaryBlock(text);
  const summary: NetWorthSummary = {
    compteTitres: summaryValue(summaryBlock, 'Compte-Titres'),
    nonCote: summaryValue(summaryBlock, 'Non Coté'),
    crypto: summaryValue(summaryBlock, 'Wallet Crypto'),
    cash: summaryValue(summaryBlock, 'Espèces'),
    pea: summaryValue(summaryBlock, "Plan d'Épargne en Actions"),
    total: summaryValue(summaryBlock, 'TOTAL'),
  };

  const identity = summary.compteTitres + summary.nonCote + summary.crypto + summary.cash + summary.pea;
  const identityDelta = identity - summary.total;
  if (Math.abs(identityDelta) > 0.02) {
    throw new Error(`Net Worth summary does not reconcile with TOTAL (delta ${identityDelta.toFixed(2)} EUR).`);
  }

  const generated = text.match(/Généré le\s+(.+?)\s+Page/i)?.[1]?.trim() ?? null;
  const positions = parsePositions(text.split(/\r?\n/));
  const warnings: string[] = [];

  if (positions.length === 0) {
    warnings.push('No position rows could be parsed from the PDF; headline values remain usable but allocation is unavailable.');
  } else {
    const expectedByPocket: Record<PositionPocket, number> = {
      'Compte-titres': summary.compteTitres,
      PEA: summary.pea,
      Crypto: summary.crypto,
      'Non cote': summary.nonCote,
    };
    for (const [pocket, expected] of Object.entries(expectedByPocket) as [PositionPocket, number][]) {
      const pocketPositions = positions.filter((position) => position.pocket === pocket);
      const parsed = pocketPositions.reduce((sum, position) => sum + position.value, 0);
      if (expected > 0 && pocketPositions.length === 0) {
        warnings.push(`${pocket} has a non-zero PDF summary (${expected.toFixed(2)} EUR) but no position rows were parsed.`);
      } else if (Math.abs(parsed - expected) > 0.03) {
        warnings.push(`${pocket} position rows differ from the PDF summary by ${(parsed - expected).toFixed(2)} EUR.`);
      }
    }

    for (const position of positions) {
      const roundingTolerance = Math.abs(position.shares) * 0.005 + 0.02;
      const displayedProductDelta = position.shares * position.price - position.value;
      if (Math.abs(displayedProductDelta) > roundingTolerance) {
        warnings.push(
          `${position.pocket} position ${position.name} is inconsistent with displayed shares × price by ${displayedProductDelta.toFixed(2)} EUR.`,
        );
      }
    }

    const missingMarketSymbols = positions.filter(
      (position) => position.pocket !== 'Non cote' && position.symbol == null,
    ).length;
    if (missingMarketSymbols > 0) {
      warnings.push(`${missingMarketSymbols} market-relevant parsed position(s) have no ISIN/ticker.`);
    }
  }

  const snapshot = {
    snapshotDate: `${snapshotMatch[3]}-${snapshotMatch[2]}-${snapshotMatch[1]}`,
    generatedAt: generated,
    summary,
    positions,
    warnings,
  };
  diagLog(`PDF parseNetWorthText OK · snapshot=${snapshot.snapshotDate} · positions=${positions.length} · warnings=${warnings.length}`);
  return snapshot;
}

export async function parseNetWorthPdf(file: File): Promise<NetWorthSnapshot> {
  diagLog('PDF parseNetWorthPdf START');
  const text = await extractLayoutText(file);
  diagLog(`PDF extractLayoutText OK · caractères=${text.length}`);
  const snapshot = parseNetWorthText(text);
  diagLog('PDF parseNetWorthPdf END');
  return snapshot;
}
