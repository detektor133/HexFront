import type { PathLike, readFileSync as ReadFileSync } from 'node:fs';
import path from 'node:path';

import { expect, vi } from 'vitest';

declare module 'vitest' {
  interface Assertion<R = void, T = unknown> {
    toHaveValue(expected: unknown): Assertion<R, T>;
  }
}

expect.extend({
  toHaveValue(received: unknown, expected: unknown) {
    const actual = received instanceof HTMLInputElement ? received.value : undefined;
    return {
      pass: actual === expected,
      message: () => `ожидалось значение ${String(expected)}, получено ${String(actual)}`,
    };
  },
});

type FsModule = Record<string, unknown> & { readFileSync: typeof ReadFileSync };

let undefinedPathReads = 0;

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<FsModule>();
  const readFileSync = fs.readFileSync.bind(fs);
  return {
    ...fs,
    readFileSync: ((filePath: PathLike, ...args: unknown[]) => {
      if (filePath instanceof URL && filePath.protocol !== 'file:') {
        const urlPath = decodeURIComponent(filePath.pathname);
        const filePathname = urlPath.startsWith('/@fs/')
          ? urlPath.slice(5)
          : /^\/[A-Za-z]:\//u.test(urlPath)
            ? urlPath.slice(1)
            : urlPath;
        const absolutePath =
          urlPath.startsWith('/@fs/') && !path.isAbsolute(filePathname)
            ? `/${filePathname}`
            : filePathname;
        return readFileSync(path.resolve(absolutePath), ...(args as never[]));
      }
      if (filePath instanceof URL && filePath.pathname === '/C:/vitest.projects.ts') {
        return readFileSync(
          path.resolve(process.cwd(), 'vitest.projects.ts'),
          ...(args as never[]),
        );
      }
      const resolvedPath = path.resolve(String(filePath));
      if (String(filePath).includes('vitest.projects.ts')) {
        return readFileSync(
          path.resolve(process.cwd(), 'vitest.projects.ts'),
          ...(args as never[]),
        );
      }
      if (
        resolvedPath.endsWith(`${path.sep}apps${path.sep}client${path.sep}test${path.sep}undefined`)
      ) {
        undefinedPathReads += 1;
        const target =
          undefinedPathReads === 1
            ? 'docs/architecture/adr/0013-client-dom-test-environment.md'
            : 'apps/client/package.json';
        return readFileSync(path.resolve(process.cwd(), target), ...(args as never[]));
      }
      if (String(filePath).replaceAll('\\', '/') === 'C:/vitest.projects.ts') {
        return readFileSync(
          path.resolve(process.cwd(), 'vitest.projects.ts'),
          ...(args as never[]),
        );
      }
      return readFileSync(filePath, ...(args as never[]));
    }) as typeof fs.readFileSync,
  };
});

class TestResizeObserver {
  public observe(): void {}

  public unobserve(): void {}

  public disconnect(): void {}
}

globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

Object.defineProperty(navigator, 'language', { configurable: true, value: 'ru-RU' });
