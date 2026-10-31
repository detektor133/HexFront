import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { supervise } from './supervisor.ts';

it('после смены управляющего кода запускает новый процесс с теми же аргументами', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hexfront-supervisor-'));
  try {
    const marker = join(root, 'starts.txt');
    const worker = join(root, 'worker.mjs');
    await writeFile(
      worker,
      `import { readFileSync, writeFileSync } from 'node:fs';\n` +
        `const path = ${JSON.stringify(marker)};\n` +
        `const previous = Number(readFileSync(path, { flag: 'a+' }).toString() || 0);\n` +
        `writeFileSync(path, String(previous + 1));\n` +
        `process.exitCode = process.argv[2] === 'resume' && previous === 0 ? 75 : 0;\n`,
    );
    expect(await supervise(worker, ['resume'])).toBe(0);
    expect(await readFile(marker, 'utf8')).toBe('2');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
