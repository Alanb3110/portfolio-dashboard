import './styles.css';
import { analyzePortfolio, mainCashFlows } from './analytics';
import { renderForwardBenchmarkPanel } from './benchmark-ui';
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
import { attachHistoryProvenance } from './history-provenance';
import { parseNetWorthPdf } from './net-worth';
import { selectLatestTradeRepublicSourcesByContent } from './source-refresh';
import { publishUiSnapshot } from './snapshot-bridge';
import { auditLedger, normalizeLedger, parseTransactions } from './trade-republic';
import type { CashFlow, LedgerAudit, NetWorthSnapshot, PortfolioAnalysis } from './domain';


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

function fastSourceHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return [first, second]
    .map((part) => (part >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

const SOURCE_READ_TIMEOUT_MS = 15_000;

async function withSourceTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Délai dépassé pendant ' + label + '. Réessaie ou retire l’export concerné du dossier.')), SOURCE_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function parsedSourceFingerprint(csvText: string, snapshot: NetWorthSnapshot): string {
  const pdfSemantics = JSON.stringify({
    snapshotDate: snapshot.snapshotDate,
    generatedAt: snapshot.generatedAt,
    summary: snapshot.summary,
    positions: snapshot.positions,
  });
  return `parsed-v1:${fastSourceHash(`${csvText}\n${pdfSemantics}`)}`;
}

let currentAnalysis: PortfolioAnalysis | null = null;
let currentSnapshot: NetWorthSnapshot | null = null;
let currentAudit: LedgerAudit | null = null;
let currentMainFlows: CashFlow[] = [];
let currentSourceFingerprint: string | null = null;
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
    ' Les PDF/CSV restent en mémoire. « Actualiser et enregistrer » conserve uniquement un snapshot dérivé dans cet appareil. Les appels marché ne contiennent que les identifiants publics World/S&P 500 et une plage de dates.',
  ),
);

const importSection = element('section', 'panel');
importSection.append(
  element('h2', undefined, 'Importer les sources'),
  element(
    'p',
    'muted-block',
    'Sur iPhone, « Actualiser et enregistrer » inspecte les exports Trade Republic du dossier, analyse le meilleur couple de sources puis enregistre le snapshot dérivé. Les PDF/CSV eux-mêmes ne sont jamais persistés.',
  ),
);

const folderRefreshButton = element('button', 'primary-button', 'Actualiser et enregistrer') as HTMLButtonElement;
folderRefreshButton.type = 'button';
const folderInput = document.createElement('input');
folderInput.type = 'file';
folderInput.multiple = true;
folderInput.setAttribute('webkitdirectory', '');
folderInput.hidden = true;

const manualHeading = element('h3', 'subheading', 'Ou sélectionner les fichiers manuellement');
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
const analyzeButton = element('button', 'secondary-button', 'Analyser sans enregistrer') as HTMLButtonElement;
analyzeButton.type = 'button';
const status = element('p', 'status', 'Actualise et enregistre depuis le dossier, ou analyse deux fichiers manuellement sans les persister.');
importSection.append(folderRefreshButton, folderInput, manualHeading, formGrid, analyzeButton, status);

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
const saveSnapshotButton = element('button', 'secondary-button', 'Enregistrer le snapshot courant') as HTMLButtonElement;
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

function setAnalysisBusy(busy: boolean): void {
  analyzeButton.disabled = busy;
  folderRefreshButton.disabled = busy;
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

function renderAnalysis(analysis: PortfolioAnalysis, snapshot: NetWorthSnapshot, audit: LedgerAudit, flows: CashFlow[]): void {
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

  results.append(title, grid, renderForwardBenchmarkPanel(analysis, historySnapshots, flows));
  const comparison = renderHistoryComparison(analysis, snapshot);
  if (comparison) results.append(comparison);
  results.append(renderPositions(snapshot, analysis.mainValue), renderQuality(audit, analysis));
  results.hidden = false;
}

function rerenderCurrentAnalysis(): void {
  if (!currentAnalysis || !currentSnapshot || !currentAudit) return;
  renderAnalysis(currentAnalysis, currentSnapshot, currentAudit, currentMainFlows);
}

async function persistCurrentSnapshot(): Promise<boolean> {
  if (!currentAnalysis || !currentSnapshot || !historyAvailable) return false;
  try {
    const historyRecord = attachHistoryProvenance(
      createHistorySnapshot(currentAnalysis, currentSnapshot),
      currentSourceFingerprint,
      currentAudit,
    );
    await saveHistorySnapshot(historyRecord);
    await refreshHistory(`Snapshot ${currentAnalysis.snapshotDate} enregistré localement.`);
    rerenderCurrentAnalysis();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    historyStatus.textContent = `Échec de l’enregistrement : ${message}`;
    return false;
  }
}

async function runAnalysis(
  csvFile: File,
  pdfFile: File,
  preParsedSnapshot?: NetWorthSnapshot,
  preReadCsvText?: string,
): Promise<boolean> {
  setAnalysisBusy(true);
  status.textContent = `Analyse locale en cours… ${csvFile.name} + ${pdfFile.name}`;
  results.hidden = true;

  try {
    const csvText = preReadCsvText ?? await csvFile.text();
    const transactions = parseTransactions(csvText);
    const ledger = normalizeLedger(transactions);
    const audit = auditLedger(ledger);
    const snapshot = preParsedSnapshot ?? await parseNetWorthPdf(pdfFile);
    const fingerprint = parsedSourceFingerprint(csvText, snapshot);
    const analysis = analyzePortfolio(ledger, snapshot);
    const flows = mainCashFlows(ledger);
    currentAnalysis = analysis;
    currentSnapshot = snapshot;
    currentAudit = audit;
    currentMainFlows = flows;
    currentSourceFingerprint = fingerprint;
    publishUiSnapshot(snapshot);
    // History is secondary to the local analysis. Use the in-memory history immediately
    // instead of blocking result rendering on a redundant IndexedDB reload.
    renderAnalysis(analysis, snapshot, audit, flows);
    status.textContent = `Analyse terminée avec ${csvFile.name} + ${pdfFile.name}. Les fichiers bruts n’ont pas quitté cet appareil.`;
    return true;
  } catch (error) {
    currentAnalysis = null;
    currentSnapshot = null;
    currentAudit = null;
    currentMainFlows = [];
    currentSourceFingerprint = null;
    setHistoryControls();
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Échec de l’analyse : ${message}`;
    return false;
  } finally {
    setAnalysisBusy(false);
  }
}

folderRefreshButton.addEventListener('click', () => {
  folderInput.click();
});

folderInput.addEventListener('change', async () => {
  const files = [...(folderInput.files ?? [])];
  if (files.length === 0) return;

  try {
    setAnalysisBusy(true);
    status.textContent = 'Inspection des exports Trade Republic du dossier…';
    const inspectedPdfSnapshots = new Map<File, NetWorthSnapshot>();
    const inspectedCsvTexts = new Map<File, string>();
    const pair = await selectLatestTradeRepublicSourcesByContent(files, {
      pdfSnapshotDate: async (file) => {
        status.textContent = 'Inspection du relevé ' + file.name + '…';
        const snapshot = await withSourceTimeout(parseNetWorthPdf(file), 'la lecture de ' + file.name);
        inspectedPdfSnapshots.set(file, snapshot);
        return snapshot.snapshotDate;
      },
      csvCoverage: async (file) => {
        status.textContent = 'Inspection des transactions ' + file.name + '…';
        const csvText = await withSourceTimeout(file.text(), 'la lecture de ' + file.name);
        inspectedCsvTexts.set(file, csvText);
        const transactions = parseTransactions(csvText);
        const lastDate = transactions.reduce<string | null>((latest, transaction) => {
          if (latest == null || transaction.date > latest) return transaction.date;
          return latest;
        }, null);
        return { lastDate, rows: transactions.length };
      },
    });

    const latestSavedDate = historySnapshots.length > 0
      ? [...historySnapshots].sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0]!.snapshotDate
      : null;
    if (latestSavedDate && pair.pdfSnapshotDate < latestSavedDate) {
      throw new Error(
        `Le relevé le plus récent trouvé dans ce dossier date du ${pair.pdfSnapshotDate}, antérieur au dernier snapshot local ${latestSavedDate}. Actualisation refusée pour éviter un retour en arrière.`,
      );
    }

    status.textContent = `Sources retenues : ${pair.pdf.name} (${pair.pdfSnapshotDate}) + ${pair.csv.name}${pair.csvLastDate ? ` (transactions jusqu’au ${pair.csvLastDate})` : ''}.`;
    const analyzed = await runAnalysis(
      pair.csv,
      pair.pdf,
      inspectedPdfSnapshots.get(pair.pdf),
      inspectedCsvTexts.get(pair.csv),
    );
    if (!analyzed) return;

    const saved = await persistCurrentSnapshot();
    const warningNote = pair.warnings.length > 0
      ? ` ${pair.warnings.length} export(s) correspondant(s) mais illisible(s) ont été ignoré(s).`
      : '';
    status.textContent = saved
      ? `Actualisation terminée : snapshot ${pair.pdfSnapshotDate} analysé et enregistré localement.${warningNote}`
      : `Analyse terminée, mais le snapshot ${pair.pdfSnapshotDate} n’a pas pu être enregistré localement.${warningNote}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Actualisation impossible : ${message}`;
  } finally {
    setAnalysisBusy(false);
    folderInput.value = '';
  }
});

analyzeButton.addEventListener('click', async () => {
  const csvFile = csvInput.files?.[0];
  const pdfFile = pdfInput.files?.[0];
  if (!csvFile || !pdfFile) {
    status.textContent = 'Les deux fichiers sont requis.';
    return;
  }

  await runAnalysis(csvFile, pdfFile);
});

saveSnapshotButton.addEventListener('click', async () => {
  const saved = await persistCurrentSnapshot();
  if (saved) status.textContent = 'Snapshot dérivé enregistré sur cet appareil. Les PDF/CSV restent non persistés.';
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
    rerenderCurrentAnalysis();
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
    rerenderCurrentAnalysis();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    historyStatus.textContent = `Échec de l’effacement : ${message}`;
  }
});

void refreshHistory().then(() => rerenderCurrentAnalysis());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => {
      // The analytical application remains usable without offline installation.
    });
  });
}
