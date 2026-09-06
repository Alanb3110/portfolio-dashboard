const SESSION_KEY = 'portfolio-dashboard-v5:diagnostic-log';
const MAX_ENTRIES = 200;

type DiagnosticEntry = {
  ts: string;
  elapsedMs: number;
  message: string;
};

const sessionStart = performance.now();
let entries: DiagnosticEntry[] = [];
let listElement: HTMLOListElement | null = null;
let heartbeatElement: HTMLParagraphElement | null = null;
let lastObservedStatus = '';
let heartbeatTick = 0;

function nowLabel(): string {
  return new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function loadPersistedEntries(): void {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as DiagnosticEntry[];
    if (Array.isArray(parsed)) entries = parsed.slice(-MAX_ENTRIES);
  } catch {
    // Diagnostics must never affect the analytical application.
  }
}

function persistEntries(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Diagnostics must never affect the analytical application.
  }
}

function renderEntry(entry: DiagnosticEntry): void {
  if (!listElement || typeof document === 'undefined') return;
  const item = document.createElement('li');
  item.textContent = `${entry.ts} · +${(entry.elapsedMs / 1000).toFixed(3)} s · ${entry.message}`;
  listElement.append(item);
}

export function diagLog(message: string): void {
  const entry: DiagnosticEntry = {
    ts: nowLabel(),
    elapsedMs: performance.now() - sessionStart,
    message,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  persistEntries();
  renderEntry(entry);
}

export function diagFile(label: string, file: File): void {
  const relativePath = 'webkitRelativePath' in file ? file.webkitRelativePath : '';
  diagLog(
    `${label}: name=${file.name}; size=${file.size} B; type=${file.type || '(vide)'}; lastModified=${new Date(file.lastModified).toISOString()}; relativePath=${relativePath || '(aucun)'}`,
  );
}

function installStatusObserver(): void {
  const observer = new MutationObserver(() => {
    const candidates = [
      ...document.querySelectorAll<HTMLElement>('.quick-status'),
      ...document.querySelectorAll<HTMLElement>('.status'),
    ].filter((node) => !node.closest('#technical-diagnostics'));

    for (const node of candidates) {
      const text = node.textContent?.trim() ?? '';
      if (!text || text === lastObservedStatus) continue;
      lastObservedStatus = text;
      diagLog(`UI: ${text}`);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
}

function installFileObservers(): void {
  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
    const files = [...(target.files ?? [])];
    diagLog(`Sélection fichier: input=${target.accept || '(dossier/aucun accept)'}; count=${files.length}`);
    files.forEach((file, index) => diagFile(`Fichier ${index + 1}/${files.length}`, file));
  }, true);
}

function installLifecycleObservers(): void {
  document.addEventListener('visibilitychange', () => diagLog(`Lifecycle: visibility=${document.visibilityState}`));
  window.addEventListener('pageshow', (event) => diagLog(`Lifecycle: pageshow persisted=${event.persisted}`));
  window.addEventListener('pagehide', (event) => diagLog(`Lifecycle: pagehide persisted=${event.persisted}`));
  window.addEventListener('focus', () => diagLog('Lifecycle: window focus'));
  window.addEventListener('blur', () => diagLog('Lifecycle: window blur'));
  document.addEventListener('freeze', () => diagLog('Lifecycle: freeze'));
  document.addEventListener('resume', () => diagLog('Lifecycle: resume'));

  window.addEventListener('error', (event) => {
    diagLog(`ERROR: ${event.message} @ ${event.filename || '(inconnu)'}:${event.lineno || 0}:${event.colno || 0}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason);
    diagLog(`UNHANDLED REJECTION: ${reason}`);
  });
}

function updateHeartbeat(): void {
  heartbeatTick += 1;
  if (!heartbeatElement) return;
  heartbeatElement.textContent = `Horloge JS : ${nowLabel()} · tick ${heartbeatTick} · ${document.visibilityState} · online=${navigator.onLine}`;
}

function mountPanel(): boolean {
  if (document.querySelector('#technical-diagnostics')) return true;
  const shell = document.querySelector<HTMLElement>('#app .shell');
  if (!shell) return false;

  const panel = document.createElement('section');
  panel.id = 'technical-diagnostics';
  panel.className = 'panel';

  const title = document.createElement('h2');
  title.textContent = 'Diagnostic technique (temporaire)';

  const note = document.createElement('p');
  note.className = 'muted-block';
  note.textContent = 'Journal détaillé volontairement verbeux. L’horloge JS doit continuer à avancer : si elle se fige, c’est le thread WebKit lui-même qui est bloqué. Le journal de cette session survit à un rechargement de la page.';

  heartbeatElement = document.createElement('p');
  heartbeatElement.className = 'status';

  listElement = document.createElement('ol');
  listElement.setAttribute('aria-label', 'Journal diagnostic');

  panel.append(title, note, heartbeatElement, listElement);

  const firstPanel = shell.querySelector(':scope > .panel');
  if (firstPanel?.nextSibling) shell.insertBefore(panel, firstPanel.nextSibling);
  else shell.append(panel);

  for (const entry of entries) renderEntry(entry);
  updateHeartbeat();
  return true;
}

function logEnvironment(): void {
  const standaloneNavigator = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const standaloneDisplay = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  diagLog(`Session diagnostic démarrée · href=${location.href}`);
  diagLog(`UA: ${navigator.userAgent}`);
  diagLog(`Environnement: standaloneNavigator=${standaloneNavigator}; standaloneDisplay=${standaloneDisplay}; hardwareConcurrency=${navigator.hardwareConcurrency ?? 'n/a'}; language=${navigator.language}`);
  diagLog(`Document: readyState=${document.readyState}; visibility=${document.visibilityState}; online=${navigator.onLine}`);

  if ('serviceWorker' in navigator) {
    const controller = navigator.serviceWorker.controller;
    diagLog(`Service Worker controller=${controller?.scriptURL ?? '(aucun)'}`);
    void navigator.serviceWorker.getRegistration().then((registration) => {
      diagLog(`Service Worker registration active=${registration?.active?.scriptURL ?? '(aucune)'}`);
    }).catch((error) => diagLog(`Service Worker registration error=${String(error)}`));
  }
}

function init(): void {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof MutationObserver === 'undefined'
  ) {
    return;
  }

  loadPersistedEntries();
  installStatusObserver();
  installFileObservers();
  installLifecycleObservers();
  logEnvironment();

  const mountTimer = window.setInterval(() => {
    if (mountPanel()) window.clearInterval(mountTimer);
  }, 50);
  window.setTimeout(() => window.clearInterval(mountTimer), 10_000);
  window.setInterval(updateHeartbeat, 1_000);
}

init();
