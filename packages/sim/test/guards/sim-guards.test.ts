import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { cruise } from 'dependency-cruiser';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FIXTURE = 'packages/sim/test/fixtures/forbidden.ts';

describe('защиты симуляции', () => {
  it('ESLint отклоняет Math.random() в packages/sim', async () => {
    const eslint = new ESLint({ cwd: ROOT, ignore: false });
    const code = await readFile(`${ROOT}${FIXTURE}`, 'utf8');
    // Путь внутри src/, чтобы применились правила sim, как к боевому коду.
    const [result] = await eslint.lintText(code, {
      filePath: `${ROOT}packages/sim/src/forbidden.ts`,
    });
    const messages = result?.messages.map((m) => m.message) ?? [];
    expect(messages.some((m) => m.includes('float-математика'))).toBe(true);
  });

  it('ESLint игнорирует eslint-disable в packages/sim', async () => {
    const eslint = new ESLint({ cwd: ROOT, ignore: false });
    const code = '// eslint-disable-next-line\nexport const roll = Math.random();\n';
    const [result] = await eslint.lintText(code, {
      filePath: `${ROOT}packages/sim/src/forbidden.ts`,
    });
    expect(result?.errorCount).toBeGreaterThan(0);
  });

  it('dependency-cruiser отклоняет импорт из apps/* в packages/sim', async () => {
    const require = createRequire(import.meta.url);
    const config = require(`${ROOT}.dependency-cruiser.cjs`) as {
      forbidden: { name: string; to: unknown }[];
      options: Record<string, unknown>;
    };
    const rule = config.forbidden.find((r) => r.name === 'sim-imports-nothing');
    expect(rule).toBeDefined();
    const cwd = process.cwd();
    process.chdir(ROOT);
    try {
      const result = await cruise([FIXTURE], {
        ...config.options,
        exclude: { path: ['node_modules'] },
        // Фикстура лежит вне src/, поэтому боевое правило переносим на её каталог.
        ruleSet: { forbidden: [{ ...rule, from: { path: '^packages/sim/test/fixtures' } }] },
        validate: true,
      } as Parameters<typeof cruise>[1]);
      const output = result.output as { summary: { error: number } };
      expect(output.summary.error).toBeGreaterThan(0);
    } finally {
      process.chdir(cwd);
    }
  });
});
