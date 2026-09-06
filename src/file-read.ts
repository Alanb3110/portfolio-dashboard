const DEFAULT_TIMEOUT_MS = 15_000;

export function readTextFile(file: File, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  if (typeof FileReader === 'undefined') {
    return Promise.race([
      file.text(),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error(`Délai dépassé pendant la lecture de ${file.name}.`)), timeoutMs);
      }),
    ]);
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      callback();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      try {
        reader.abort();
      } catch {
        // Best-effort abort only; the timeout error remains authoritative.
      }
      finish(() => reject(new Error(`Délai dépassé pendant la lecture de ${file.name}.`)));
    }, timeoutMs);

    reader.onload = () => {
      finish(() => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error(`Lecture texte invalide pour ${file.name}.`));
        }
      });
    };

    reader.onerror = () => {
      const detail = reader.error?.message ?? 'erreur FileReader inconnue';
      finish(() => reject(new Error(`Impossible de lire ${file.name} : ${detail}`)));
    };

    reader.onabort = () => {
      finish(() => reject(new Error(`Lecture interrompue pour ${file.name}.`)));
    };

    try {
      reader.readAsText(file, 'UTF-8');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      finish(() => reject(new Error(`Impossible de démarrer la lecture de ${file.name} : ${detail}`)));
    }
  });
}
