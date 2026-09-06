from pathlib import Path

path = Path('src/main.ts')
source = path.read_text()
source = source.replace(
    "import { selectLatestTradeRepublicSources } from './source-refresh';",
    "import { selectSingleTradeRepublicSources } from './source-refresh';",
)
source = source.replace(
    "import { publishUiSnapshot } from './snapshot-bridge';",
    "import { publishUiSnapshot } from './snapshot-bridge';\nimport { readTextFile } from './file-read';",
)
source = source.replace(
    "const csvText = preReadCsvText ?? await csvFile.text();",
    "const csvText = preReadCsvText ?? await readTextFile(csvFile, SOURCE_READ_TIMEOUT_MS);",
)
source = source.replace(
    "const pair = selectLatestTradeRepublicSources(files);",
    "const pair = selectSingleTradeRepublicSources(files);",
)
source = source.replace(
    "const csvText = await withSourceTimeout(pair.csv.text(), `la lecture de ${pair.csv.name}`);",
    "const csvText = await readTextFile(pair.csv, SOURCE_READ_TIMEOUT_MS);",
)
source = source.replace(
    "Sur iPhone, « Actualiser et enregistrer » sélectionne les exports Trade Republic les plus récents du dossier, les lit une seule fois puis enregistre le snapshot dérivé. Les PDF/CSV eux-mêmes ne sont jamais persistés.",
    "Sur iPhone, le dossier doit contenir un seul Net Worth PDF et un seul Transaction export CSV. « Actualiser et enregistrer » les lit une seule fois puis enregistre le snapshot dérivé. En cas de doublon, utilise la sélection manuelle.",
)
path.write_text(source)
