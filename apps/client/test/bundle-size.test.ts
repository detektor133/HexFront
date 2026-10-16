import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertInitialLoadWithinLimit,
  calculateInitialLoadBytes,
} from '../scripts/check-bundle-size.ts';
import viteConfig from '../vite.config.ts';

function createFakeDist(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hexfront-bundle-'));
  mkdirSync(join(directory, 'assets'));
  writeFileSync(
    join(directory, 'index.html'),
    [
      '<script type="module" src="/assets/main.js"></script>',
      '<link rel="stylesheet" href="/assets/main.css">',
      '<link rel="preload" href="/assets/preload.js">',
      '<link rel="modulepreload" href="/assets/preload.js">',
      '<link rel="icon" href="/icon.svg">',
      '<link rel="manifest" href="/manifest.webmanifest">',
    ].join('\n'),
  );
  writeFileSync(join(directory, 'assets/main.js'), 'main');
  writeFileSync(join(directory, 'assets/main.css'), 'css');
  writeFileSync(join(directory, 'assets/preload.js'), 'preload');
  writeFileSync(join(directory, 'assets/shared.js'), 'shared');
  writeFileSync(join(directory, 'assets/dynamic.js'), 'dynamic');
  writeFileSync(join(directory, 'assets/background-match.js'), 'background');
  writeFileSync(join(directory, 'icon.svg'), 'icon');
  writeFileSync(join(directory, 'manifest.webmanifest'), 'manifest');
  mkdirSync(join(directory, 'maps'));
  writeFileSync(join(directory, 'maps/gen-42-30.json'), 'map');
  mkdirSync(join(directory, '.vite'));
  writeFileSync(
    join(directory, '.vite/manifest.json'),
    JSON.stringify({
      'src/main.tsx': {
        file: 'assets/main.js',
        imports: ['src/shared.ts'],
        dynamicImports: ['src/dynamic.ts'],
      },
      'src/shared.ts': { file: 'assets/shared.js', imports: [] },
      'src/dynamic.ts': { file: 'assets/dynamic.js', imports: [] },
      'src/background-match.ts': { file: 'assets/background-match.js', imports: [] },
    }),
  );
  return directory;
}

describe('контроль размера начальной загрузки клиента', () => {
  it('критерий: build.manifest включён в конфигурации сборки', () => {
    const config = viteConfig({ command: 'build', mode: 'production' });

    expect(config.build?.manifest).toBe(true);
  });

  it('критерий: сумма index.html и статических импортов по манифесту исключает динамические импорты, карты и фоновый матч', () => {
    const directory = createFakeDist();

    try {
      // 4 + 3 + 7 + 6 + 4 + 8 = 32 байта; dynamic.js, карта и background-match.js не входят.
      expect(calculateInitialLoadBytes(directory)).toBe(32);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('критерий: проверка падает при сумме больше 10 МБ', () => {
    const directory = createFakeDist();
    writeFileSync(join(directory, 'assets/main.js'), Buffer.alloc(10 * 1024 * 1024 + 1));

    try {
      expect(() => assertInitialLoadWithinLimit(directory)).toThrow(/10 МБ/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('критерий: скрипт проверки запускается в CI после сборки клиента', async () => {
    const workflowText = readFileSync(
      new URL('../../../.github/workflows/pages.yml', import.meta.url),
      'utf8',
    );
    const jobsStart = workflowText.indexOf('\njobs:\n');
    const deployStart = workflowText.indexOf('\n  deploy:\n', jobsStart);
    const nextJobStart = workflowText.slice(deployStart + 1).search(/\n[ ]{2}[a-zA-Z0-9_-]+:\n/);
    const deployJob = workflowText.slice(
      deployStart,
      nextJobStart === -1 ? workflowText.length : deployStart + 1 + nextJobStart,
    );

    expect(jobsStart).toBeGreaterThanOrEqual(0);
    expect(deployStart).toBeGreaterThan(jobsStart);
    const buildPosition = deployJob.indexOf('run: pnpm --filter @hexfront/client build');
    const checkPosition = deployJob.indexOf(
      'run: pnpm --filter @hexfront/client check-bundle-size',
    );

    expect(buildPosition).toBeGreaterThanOrEqual(0);
    expect(checkPosition).toBeGreaterThan(buildPosition);
  });
});
