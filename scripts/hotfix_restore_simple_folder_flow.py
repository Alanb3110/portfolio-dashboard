from pathlib import Path

path = Path('src/main.ts')
source = path.read_text()

source = source.replace(
    "import { selectLatestTradeRepublicSourcesByContent } from './source-refresh';",
    "import { selectLatestTradeRepublicSources } from './source-refresh';",
)

old_copy = "Sur iPhone, « Actualiser et enregistrer » inspecte les exports Trade Republic du dossier, analyse le meilleur couple de sources puis enregistre le snapshot dérivé. Les PDF/CSV eux-mêmes ne sont jamais persistés."
new_copy = "Sur iPhone, « Actualiser et enregistrer » sélectionne les exports Trade Republic les plus récents du dossier, les lit une seule fois puis enregistre le snapshot dérivé. Les PDF/CSV eux-mêmes ne sont jamais persistés."
source = source.replace(old_copy, new_copy)

start = source.index("folderInput.addEventListener('change', async () => {")
end = source.index("\nanalyzeButton.addEventListener('click', async () => {", start)
replacement = '''folderInput.addEventListener('change', async () => {
  const files = [...(folderInput.files ?? [])];
  if (files.length === 0) return;

  try {
    setAnalysisBusy(true);
    const pair = selectLatestTradeRepublicSources(files);

    status.textContent = `Lecture du relevé ${pair.pdf.name}…`;
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
    const csvText = await withSourceTimeout(pair.csv.text(), `la lecture de ${pair.csv.name}`);

    status.textContent = `Sources retenues : ${pair.pdf.name} (${snapshot.snapshotDate}) + ${pair.csv.name}.`;
    const analyzed = await runAnalysis(pair.csv, pair.pdf, snapshot, csvText);
    if (!analyzed) return;

    const saved = await persistCurrentSnapshot();
    status.textContent = saved
      ? `Actualisation terminée : snapshot ${snapshot.snapshotDate} analysé et enregistré localement.`
      : `Analyse terminée, mais le snapshot ${snapshot.snapshotDate} n’a pas pu être enregistré localement.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Actualisation impossible : ${message}`;
  } finally {
    setAnalysisBusy(false);
    folderInput.value = '';
  }
});
'''
source = source[:start] + replacement + source[end:]
path.write_text(source)
