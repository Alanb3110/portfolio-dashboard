from pathlib import Path

index = Path('index.html')
text = index.read_text()
text = text.replace(
    '    <script type="module" src="/src/app.ts"></script>',
    '    <script type="module" src="/src/main.ts"></script>\n'
    '    <script type="module" src="/src/overview-ui.ts"></script>\n'
    '    <script type="module" src="/src/history-chart-ui.ts"></script>\n'
    '    <script type="module" src="/src/allocation-ui.ts"></script>\n'
    '    <script type="module" src="/src/rebalancing-ui.ts"></script>',
)
index.write_text(text)

overview = Path('src/overview-ui.ts')
text = overview.read_text()
text = text.replace(
    "if (!enhanceOverview()) throw new Error('Overview bootstrap could not find the deterministic main application shell.');",
    "if (!enhanceOverview()) {\n"
    "  const startupObserver = new MutationObserver(() => {\n"
    "    if (!enhanceOverview()) return;\n"
    "    startupObserver.disconnect();\n"
    "  });\n"
    "  startupObserver.observe(document.documentElement, { childList: true, subtree: true });\n"
    "}",
)
overview.write_text(text)

allocation = Path('src/allocation-ui.ts')
text = allocation.read_text()
text = text.replace(
    "if (!setupAllocationUi()) throw new Error('Allocation UI bootstrap requires the main results container.');",
    "if (!setupAllocationUi()) {\n"
    "  const observer = new MutationObserver(() => {\n"
    "    if (!setupAllocationUi()) return;\n"
    "    observer.disconnect();\n"
    "  });\n"
    "  observer.observe(document.documentElement, { childList: true, subtree: true });\n"
    "}",
)
allocation.write_text(text)

main = Path('src/main.ts')
text = main.read_text()
text = text.replace("import { readTextFile } from './file-read';\n", '')
text = text.replace(
"""async function runAnalysis(
  csvFile: File,
  pdfFile: File,
  preParsedSnapshot?: NetWorthSnapshot,
  preReadCsvText?: string,
): Promise<boolean> {""",
"""async function runAnalysis(
  csvFile: File,
  pdfFile: File,
  minimumSnapshotDate?: string | null,
): Promise<boolean> {""",
)
text = text.replace(
"""    const csvText = preReadCsvText ?? await readTextFile(csvFile, SOURCE_READ_TIMEOUT_MS);
    const transactions = parseTransactions(csvText);
    const ledger = normalizeLedger(transactions);
    const audit = auditLedger(ledger);
    const snapshot = preParsedSnapshot ?? await parseNetWorthPdf(pdfFile);
    const fingerprint = parsedSourceFingerprint(csvText, snapshot);
    const analysis = analyzePortfolio(ledger, snapshot);
    const flows = mainCashFlows(ledger);""",
"""    status.textContent = `Lecture des transactions ${csvFile.name}…`;
    const csvText = await csvFile.text();
    status.textContent = `Parsing et contrôles des transactions ${csvFile.name}…`;
    const transactions = parseTransactions(csvText);
    const ledger = normalizeLedger(transactions);
    const audit = auditLedger(ledger);
    status.textContent = `Lecture du relevé ${pdfFile.name}…`;
    const snapshot = await parseNetWorthPdf(pdfFile);
    if (minimumSnapshotDate && snapshot.snapshotDate < minimumSnapshotDate) {
      throw new Error(
        `Le relevé sélectionné date du ${snapshot.snapshotDate}, antérieur au dernier snapshot local ${minimumSnapshotDate}. Actualisation refusée pour éviter un retour en arrière.`,
      );
    }
    status.textContent = `Calcul du portefeuille au ${snapshot.snapshotDate}…`;
    const fingerprint = parsedSourceFingerprint(csvText, snapshot);
    const analysis = analyzePortfolio(ledger, snapshot);
    const flows = mainCashFlows(ledger);""",
)
text = text.replace(
"""    status.textContent = `Lecture du relevé ${pair.pdf.name}…`;
    const snapshot = await withSourceTimeout(parseNetWorthPdf(pair.pdf), `la lecture de ${pair.pdf.name}`);

    const latestSavedDate = historySnapshots.length > 0
      ? [...historySnapshots].sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0]!.snapshotDate
      : null;
    if (latestSavedDate && snapshot.snapshotDate < latestSavedDate) {
      throw new Error(
        `Le relevé sélectionné date du ${snapshot.snapshotDate}, antérieur au dernier snapshot local ${latestSavedDate}. Actualisation refusée pour éviter un retour en arrière.`,
      );
    }

    status.textContent = `Lecture des transactions ${pair.csv.name}…`;
    const csvText = await readTextFile(pair.csv, SOURCE_READ_TIMEOUT_MS);

    status.textContent = `Sources retenues : ${pair.pdf.name} (${snapshot.snapshotDate}) + ${pair.csv.name}.`;
    const analyzed = await runAnalysis(pair.csv, pair.pdf, snapshot, csvText);
    if (!analyzed) return;

    const saved = await persistCurrentSnapshot();
    status.textContent = saved
      ? `Actualisation terminée : snapshot ${snapshot.snapshotDate} analysé et enregistré localement.`
      : `Analyse terminée, mais le snapshot ${snapshot.snapshotDate} n’a pas pu être enregistré localement.`;""",
"""    const latestSavedDate = historySnapshots.length > 0
      ? [...historySnapshots].sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0]!.snapshotDate
      : null;

    const analyzed = await runAnalysis(pair.csv, pair.pdf, latestSavedDate);
    if (!analyzed) return;

    const snapshotDate = currentSnapshot?.snapshotDate ?? 'inconnu';
    const saved = await persistCurrentSnapshot();
    status.textContent = saved
      ? `Actualisation terminée : snapshot ${snapshotDate} analysé et enregistré localement.`
      : `Analyse terminée, mais le snapshot ${snapshotDate} n’a pas pu être enregistré localement.`;""",
)
main.write_text(text)

Path('src/app.ts').unlink(missing_ok=True)
Path('src/file-read.ts').unlink(missing_ok=True)
