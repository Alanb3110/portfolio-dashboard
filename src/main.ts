import './styles.css';
import { analyzePortfolio } from './analytics';
import { parseNetWorthPdf } from './net-worth';
import { auditLedger, normalizeLedger, parseTransactions } from './trade-republic';
import type { LedgerAudit, NetWorthSnapshot, PortfolioAnalysis } from './domain';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root not found.');

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function metric(label: string, value: string, subtext?: string): HTMLElement {
  const card = element('section', 'metric-card');
  card.append(element('p', 'metric-label', label), element('strong', 'metric-value', value));
  if (subtext) card.append(element('p', 'metric-subtext', subtext));
  return card;
}

const shell = element('div', 'shell');
const header = element('header', 'hero');
header.append(
  element('p', 'eyebrow', 'Portfolio Dashboard v5'),
  element('h1', undefined, 'Analyse locale du portefeuille'),
  element(
    'p',
    'lede',
    'Les exports Trade Republic sont lus et analysés dans ce navigateur. Aucun fichier personnel n’est envoyé par cette version.',
  ),
);

const privacy = element('aside', 'privacy');
privacy.append(
  element('strong', undefined, 'Mode local strict'),
  element(
    'span',
    undefined,
    ' Les données restent uniquement en mémoire et sont effacées au rechargement de la page.',
  ),
);

const importSection = element('section', 'panel');
importSection.append(element('h2', undefined, 'Importer les sources'));
const formGrid = element('div', 'file-grid');

const csvLabel = element('label', 'file-card');
csvLabel.append(element('span', 'file-title', 'Transaction export.csv'));
const csvInput = document.createElement('input');
csvInput.type = 'file';
csvInput.accept = '.csv,text/csv';
csvLabel.append(csvInput);

const pdfLabel = element('label', 'file-card');
pdfLabel.append(element('span', 'file-title', 'Net Worth.pdf'));
const pdfInput = document.createElement('input');
pdfInput.type = 'file';
pdfInput.accept = '.pdf,application/pdf';
pdfLabel.append(pdfInput);

formGrid.append(csvLabel, pdfLabel);
const analyzeButton = element('button', 'primary-button', 'Analyser') as HTMLButtonElement;
analyzeButton.type = 'button';
const status = element('p', 'status', 'Sélectionne les deux fichiers pour commencer.');
importSection.append(formGrid, analyzeButton, status);

const results = element('section', 'results');
results.hidden = true;

shell.append(header, privacy, importSection, results);
app.append(shell);

function renderPositions(snapshot: NetWorthSnapshot, mainValue: number): HTMLElement {
  const section = element('section', 'panel');
  section.append(element('h2', undefined, 'Positions principales'));
  const mainPositions = snapshot.positions
    .filter((position) => position.pocket === 'Compte-titres' || position.pocket === 'PEA')
    .sort((a, b) => b.value - a.value);

  if (mainPositions.length === 0) {
    section.append(element('p', 'muted', 'Allocation indisponible : les lignes de positions n’ont pas été extraites du PDF.'));
    return section;
  }

  const list = element('div', 'position-list');
  for (const position of mainPositions) {
    const row = element('div', 'position-row');
    const identity = element('div');
    identity.append(
      element('strong', undefined, position.name),
      element('span', 'muted', `${position.pocket} · ${position.symbol ?? 'sans symbole'}`),
    );
    const values = element('div', 'position-values');
    const weight = mainValue > 0 ? position.value / mainValue : 0;
    values.append(element('strong', undefined, formatEur(position.value)), element('span', 'muted', formatPercent(weight)));
    row.append(identity, values);
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderQuality(audit: LedgerAudit, analysis: PortfolioAnalysis): HTMLElement {
  const section = element('section', 'panel');
  section.append(element('h2', undefined, 'Qualité des données'));
  const list = element('dl', 'quality-grid');
  const entries: Array<[string, string]> = [
    ['Transactions', String(audit.rows)],
    ['IDs dupliqués', String(audit.duplicateTransactionIds)],
    ['BUY/SELL principaux', String(audit.mainBuySellRows)],
    ['Champs marché complets', `${audit.mainRequiredMarketFieldsComplete}/${audit.mainBuySellRows}`],
    ['Écarts date / Europe-Paris (main)', String(audit.mainRelevantDateVsParisMismatches)],
    ['Montants trade non résolus', String(audit.unresolvedMissingTradeAmounts)],
    ['Période CSV', `${audit.firstDate} → ${audit.lastDate}`],
  ];
  for (const [term, value] of entries) {
    list.append(element('dt', undefined, term), element('dd', undefined, value));
  }
  section.append(list);

  if (analysis.warnings.length > 0) {
    const warnings = element('ul', 'warnings');
    for (const warning of analysis.warnings) warnings.append(element('li', undefined, warning));
    section.append(warnings);
  } else {
    section.append(element('p', 'pass', 'Aucune limitation détectée sur les contrôles actuellement implémentés.'));
  }
  return section;
}

function renderAnalysis(analysis: PortfolioAnalysis, snapshot: NetWorthSnapshot, audit: LedgerAudit): void {
  results.replaceChildren();
  const title = element('div', 'section-heading');
  const qualityStatus = analysis.warnings.length > 0 ? 'WARN' : analysis.mainXirr.status;
  title.append(element('h2', undefined, `Snapshot ${analysis.snapshotDate}`), element('span', 'badge', qualityStatus));

  const grid = element('div', 'metrics');
  grid.append(
    metric('Portefeuille principal', formatEur(analysis.mainValue), 'Compte-titres + PEA'),
    metric('P&L économique', formatEur(analysis.simpleEconomicPnl), 'Valeur actuelle + flux canoniques'),
    metric('XIRR principal', formatPercent(analysis.mainXirr.selectedRoot), analysis.mainXirr.note),
    metric('Investi étendu', formatEur(analysis.extendedInvestedValue), 'Principal + crypto'),
    metric('Patrimoine Trade Republic', formatEur(analysis.totalNetWorth), 'Informationnel'),
  );

  results.append(title, grid, renderPositions(snapshot, analysis.mainValue), renderQuality(audit, analysis));
  results.hidden = false;
}

analyzeButton.addEventListener('click', async () => {
  const csvFile = csvInput.files?.[0];
  const pdfFile = pdfInput.files?.[0];
  if (!csvFile || !pdfFile) {
    status.textContent = 'Les deux fichiers sont requis.';
    return;
  }

  analyzeButton.disabled = true;
  status.textContent = 'Analyse locale en cours…';
  results.hidden = true;

  try {
    const transactions = parseTransactions(await csvFile.text());
    const ledger = normalizeLedger(transactions);
    const audit = auditLedger(ledger);
    const snapshot = await parseNetWorthPdf(pdfFile);
    const analysis = analyzePortfolio(ledger, snapshot);
    renderAnalysis(analysis, snapshot, audit);
    status.textContent = 'Analyse terminée. Les fichiers n’ont pas quitté cet appareil.';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Échec de l’analyse : ${message}`;
  } finally {
    analyzeButton.disabled = false;
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => {
      // The analytical application remains usable without offline installation.
    });
  });
}
