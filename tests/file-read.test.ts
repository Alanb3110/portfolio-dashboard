import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTextFile } from '../src/file-read';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readTextFile', () => {
  it('uses FileReader in browsers instead of File.text()', async () => {
    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onabort: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

      readAsText(): void {
        this.result = 'a,b\n1,2';
        queueMicrotask(() => this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>));
      }

      abort(): void {}
    }

    vi.stubGlobal('FileReader', MockFileReader);
    const file = {
      name: 'Transaction export.csv',
      text: vi.fn(async () => { throw new Error('File.text() must not be used'); }),
    } as unknown as File;

    await expect(readTextFile(file, 100)).resolves.toBe('a,b\n1,2');
    expect(file.text).not.toHaveBeenCalled();
  });

  it('fails with an explicit timeout if FileReader never completes', async () => {
    class HangingFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onabort: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      readAsText(): void {}
      abort(): void {}
    }

    vi.stubGlobal('FileReader', HangingFileReader);
    const file = { name: 'Transaction export.csv' } as File;

    await expect(readTextFile(file, 5)).rejects.toThrow(/Délai dépassé/);
  });
});
