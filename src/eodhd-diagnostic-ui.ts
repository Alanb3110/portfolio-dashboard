import { BENCHMARKS } from './benchmark';
import { runEodhdDiagnostic } from './providers/eodhd';

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

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(value);
}

function mount(): void {
  const shell = document.querySelector<HTMLElement>('.shell');
  if (!shell || document.querySelector('#eodhd-diagnostic')) return;

  const section = element('section', 'panel');
  section.id = 'eodhd-diagnostic';
  section.append(
    element('h2', undefined, 'Test données benchmark'),
    element(
      'p',
      'muted-block',
      'Diagnostic optionnel : la clé EODHD reste uniquement en mémoire. Le test envoie au fournisseur les deux identifiants publics EUNL.XETRA et SXR8.XETRA sur les 35 derniers jours, sans aucune donnée de portefeuille.',
    ),
  );

  const label = element('label', 'file-card');
  label.append(element('span', 'file-title', 'Clé API EODHD gratuite'));
  const tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.autocomplete = 'off';
  tokenInput.spellcheck = false;
  tokenInput.placeholder = 'Coller la clé ici';
  label.append(tokenInput);

  const button = element('button', 'secondary-button', 'Tester EUNL + SXR8') as HTMLButtonElement;
  button.type = 'button';
  const status = element('p', 'status', 'Aucune requête externe n’est faite tant que ce bouton n’est pas utilisé.');
  const output = element('div', 'history-list');
  section.append(label, button, status, output);

  const results = shell.querySelector('.results');
  if (results) shell.insertBefore(section, results);
  else shell.append(section);

  button.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      status.textContent = 'Une clé EODHD est requise pour lancer ce test.';
      return;
    }

    button.disabled = true;
    output.replaceChildren();
    status.textContent = 'Test EODHD en cours… 2 requêtes publiques maximum.';
    const from = isoDateOffset(-35);
    const to = isoDateOffset(0);

    try {
      for (const benchmark of [BENCHMARKS['msci-world'], BENCHMARKS.sp500]) {
        const result = await runEodhdDiagnostic(benchmark, token, from, to);
        const row = element('div', 'history-row');
        const identity = element('span', undefined, `${benchmark.label} · ${result.symbol}`);
        const detail = element(
          'strong',
          undefined,
          `${result.rows} séances · ${result.firstDate} → ${result.lastDate} · adj. ${formatNumber(result.latestAdjustedClose)} €`,
        );
        row.append(identity, detail);
        output.append(row);
      }
      status.textContent = 'PASS : le navigateur peut lire les deux séries EODHD. La clé n’a pas été enregistrée par Portfolio Dashboard.';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status.textContent = `ÉCHEC : ${message}`;
    } finally {
      button.disabled = false;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
