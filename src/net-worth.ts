import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { NetWorthSnapshot, NetWorthSummary, PositionPocket, SnapshotPosition } from './domain';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
  const bytes = new Uint8Array(await file.arrayBuffer());
  const document = await getDocument({ data: bytes }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PositionedText[] = [];

    for (const item of content.items) {
      if (!('str' in item) || !('transform' in item)) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      items.push({ x, y, text: item.str });
    }

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
  }

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
      const parsed = positions
        .filter((position) => position.pocket === pocket)
        .reduce((sum, position) => sum + position.value, 0);
      if (parsed > 0 && Math.abs(parsed - expected) > 0.03) {
        warnings.push(`${pocket} position rows differ from the PDF summary by ${(parsed - expected).toFixed(2)} EUR.`);
      }
    }

    // Market identifiers are required for the main and crypto pockets only.
    // Non-listed assets are informational and intentionally excluded from performance/benchmark market-data lookups.
    const missingMarketSymbols = positions.filter(
      (position) => position.pocket !== 'Non cote' && position.symbol == null,
    ).length;
    if (missingMarketSymbols > 0) {
      warnings.push(`${missingMarketSymbols} market-relevant parsed position(s) have no ISIN/ticker.`);
    }
  }

  return {
    snapshotDate: `${snapshotMatch[3]}-${snapshotMatch[2]}-${snapshotMatch[1]}`,
    generatedAt: generated,
    summary,
    positions,
    warnings,
  };
}

export async function parseNetWorthPdf(file: File): Promise<NetWorthSnapshot> {
  return parseNetWorthText(await extractLayoutText(file));
}
