import './styles.css';
import { analyzePortfolio } from './analytics';
import {
  buildHistoryBackup,
  compareHistorySnapshots,
  createHistorySnapshot,
  eraseHistorySnapshots,
  importHistorySnapshots,
  loadHistorySnapshots,
  parseHistoryBackup,
  previousHistorySnapshot,
  saveHistorySnapshot,
  type HistorySnapshot,
} from './history';
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

function formatSignedEur(value: number): string {
  if (value === 0) return formatEur(0);
  return `${value > 0 ? '+' : '−'}${formatEur(Math.abs(value))}`;
}

function formatPercent(value: number | null): string {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedPoints(value: number): string {
  const points = value * 100;
  if (Math.abs(points) < 0.05) return '0,0 pp';
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(points));
  return `${points > 0 ? '+' : '−'}${formatted} pp`;
}

function metric(label: string, value: string, subtext?: string): HTMLElement {
  const card = element('section', 'metric-card');
  card.append(element('p', 'metric-label', label), element('strong', 'metric-value', value));
  if (subtext) card.append(element('p', 'metric-subtext', subtext));
  return card;
}

let currentAnalysis: PortfolioAnalysis | null = null;
let currentSnapshot: NetWorthSnapshot | null = null;
let historySnapshots: HistorySnapshot[] = [];
let historyAvailable = true;

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
    ' Les PDF/CSV restent en mémoire. Seuls des snapshots dérivés sont conservés sur cet appareil si tu choisis explicitement de les enregistrer.',
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

const historySection = element('section', 'panel');
historySection.append(
  element('h2', undefined, 'Historique local'),
  element(
    'p',
    'muted-block',
    'Enregistre uniquement les résultats dérivés nécessaires au suivi dans IndexedDB. Les fichiers source et le ledger brut ne sont jamais sauvegardés par cette fonction.',
  ),
);
const historyActions = element('div', 'action-grid');
const saveSnapshotButton = element('button', 'secondary-button', 'Enregistrer le snapshot') as HTMLButtonElement;
saveSnapshotButton.type = 'button';
saveSnapshotButton.disabled = true;
const exportBackupButton = element('button', 'secondary-button', 'Exporter la sauvegarde') as HTMLButtonElement;
exportBackupButton.type = 'button';
const importBackupButton = element('button', 'secondary-button', 'Importer une sauvegarde') as HTMLButtonElement;
importBackupButton.type = 'button';
const eraseHistoryButton = element('button', 'danger-button', 'Effacer les données locales') as HTMLButtonElement;
eraseHistoryButton.type = 'button';
historyActions.append(saveSnapshotButton, exportBackupButton, importBackupButton, eraseHistoryButton);

const backupInput = document.createElement('input');
backupInput.type = 'file';
backupInput.accept = '.json,application/json';
backupInput.hidden = true;
const historyStatus = element('p', 'status', 'Chargement de l’historique local…');
const historyList = element('div', 'history-list');
historySection.append(historyActions, backupInput, historyStatus, historyList);

const results = element('section', 'results');
results.hidden = true;

shell.append(header, privacy, importSection, historySection, results);
app.append(shell);

function setHistoryControls(): void {
  saveSnapshotButton.disabled = !historyAvailable || currentAnalysis == null || currentSnapshot == null;
  exportBackupButton.disabled = !historyAvailable || historySnapshots.length === 0;
  importBackupButton.disabled = !historyAvailable;
  eraseHistoryButton.disabled = !historyAvailable || historySnapshots.length === 0;
}

function renderHistoryList(): void {
  historyList.replaceChildren();
  if (historySnapshots.length === 0) {
    historyList.append(element('p', 'muted-block', 'Aucun snapshot enregistré sur cet appareil.'));
    return;
  }

  const recent = [...historySnapshots].sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate)).slice(0, 6);
  for (const snapshot of recent) {
    const row = element('div', 'history-row');
    row.append(
      element('span', undefined, snapshot.snapshotDate),
      element('strong', undefined, formatEur(snapshot.mainValue)),
    );
    historyList.append(row);
  }
}

async function refreshHistory(message?: string): Promise<void> {
  try {
    historySnapshots = await loadHistorySnapshots();
    historyAvailable = true;
    historyStatus.textContent = message ?? `${historySnapshots.length} snapshot(s) enregistré(s) localement.`;
  } catch (error) {
    historyAvailable = false;
    const detail = error instanceof Error ? error.message : String(error);
    historyStatus.textContent = `Historique local indisponible : ${detail}`;
  }
  setHistoryControls();
  renderHistoryList();
}

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

function renderHistoryComparison(analysis: PortfolioAnalysis, snapshot: NetWorthSnapshot): HTMLElement | null {
  const current = createHistorySnapshot(analysis, snapshot);
  const previous = previousHistorySnapshot(historySnapshots, current.snapshotDate);
  if (!previous) return null;

  const comparison = compareHistorySnapshots(current, previous);
  const section = element('section', 'panel');
  section.append(
    element('h2', undefined, `Depuis le snapshot du ${comparison.previousDate}`),
    element(
      'p',
      'muted-block',
      'Variation brute entre deux relevés officiels : elle inclut les apports et retraits et ne doit pas être interprétée comme un rendement.',
    ),
  );

  const summary = element('div', 'comparison-grid');
  summary.append(
    metric('Variation valeur principale', formatSignedEur(comparison.mainValueDelta), formatPercent(comparison.mainValueDeltaRatio)),
  );
  section.append(summary);

  const meaningful = comparison.allocationDeltas.filter((item) => Math.abs(item.weightDelta) >= 0.0005).slice(0, 5);
  if (meaningful.length > 0) {
    section.append(element('h3', 'subheading', 'Principales dérives d’allocation'));
    const list = element('div', 'position-list');
    for (const item of meaningful) {
      const row = element('div', 'position-row');
      const identity = element('div');
      identity.append(element('strong', undefined, item.name), element('span', 'muted', item.symbol ?? 'sans symbole'));
      const values = element('div', 'position-values');
      values.append(element('strong', undefined, formatSignedPoints(item.weightDelta)));
      row.append(identity, values);
      list.append(row);
    }
    section.append(list);
  }
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

  results.append(title, grid);
  const comparison = renderHistoryComparison(analysis, snapshot);
  if (comparison) results.append(comparison);
  results.append(renderPositions(snapshot, analysis.mainValue), renderQuality(audit, analysis));
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
    currentAnalysis = analysis;
    currentSnapshot = snapshot;
    await refreshHistory();
    renderAnalysis(analysis, snapshot, audit);
    status.textContent = 'Analyse terminée. Les fichiers bruts n’ont pas quitté cet appareil et ne sont pas sauvegardés.';
  } catch (error) {
    currentAnalysis = null;
    currentSnapshot = null;
    setHistoryControls();
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Échec de l’analyse : ${message}`;
  } finally {
    analyzeButton.disabled = false;
  }
});

saveSnapshotButton.addEventListener('click', async () => {
  if (!currentAnalysis || !currentSnapshot) return;
  try {
    await saveHistorySnapshot(createHistorySnapshot(currentAnalysis, currentSnapshot));
    await refreshHistory(`Snapshot ${currentAnalysis.snapshotDate} enregistré localement.`);
    status.textContent = 'Snapshot dérivé enregistré sur cet appareil. Les PDF/CSV restent non persistés.';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    historyStatus.textContent = `Échec de l’enregistrement : ${message}`;
  }
});

exportBackupButton.addEventListener('click', () => {
  if (historySnapshots.length === 0) return;
  const backup = buildHistoryBackup(historySnapshots);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `portfolio-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  historyStatus.textContent = 'Sauvegarde exportée. Ce fichier contient des données financières dérivées : conserve-le de façon privée.';
});

importBackupButton.addEventListener('click', () => backupInput.click());

backupInput.addEventListener('change', async () => {
  const file = backupInput.files?.[0];
  if (!file) return;
  try {
    const backup = parseHistoryBackup(await file.text());
    historySnapshots = await importHistorySnapshots(backup.snapshots);
    historyAvailable = true;
    setHistoryControls();
    renderHistoryList();
    historyStatus.textContent = `${backup.snapshots.length} snapshot(s) importé(s) ; ${historySnapshots.length} date(s) disponible(s) après fusion.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    historyStatus.textContent = `Sauvegarde refusée : ${message}`;
  } finally {
    backupInput.value = '';
  }
});

eraseHistoryButton.addEventListener('click', async () => {
  if (!window.confirm('Effacer tous les snapshots locaux de Portfolio Dashboard sur cet appareil ?')) return;
  try {
    await eraseHistorySnapshots();
    await refreshHistory('Historique local effacé.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    historyStatus.textContent = `Échec de l’effacement : ${message}`;
  }
});

void refreshHistory();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => {
      // The analytical application remains usable without offline installation.
    });
  });
}
