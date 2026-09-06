import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type PdfJsWorkerModule = {
  WorkerMessageHandler?: unknown;
};

type GlobalWithPdfJsWorker = typeof globalThis & {
  pdfjsWorker?: {
    WorkerMessageHandler: unknown;
  };
};

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function installIosPdfJsFakeWorker(): Promise<void> {
  if (!isIosDevice()) return;

  const workerModule = await import(/* @vite-ignore */ pdfWorkerUrl) as PdfJsWorkerModule;
  if (!workerModule.WorkerMessageHandler) {
    throw new Error('PDF.js iOS fallback could not load WorkerMessageHandler.');
  }

  (globalThis as GlobalWithPdfJsWorker).pdfjsWorker = {
    WorkerMessageHandler: workerModule.WorkerMessageHandler,
  };
}

await installIosPdfJsFakeWorker();
