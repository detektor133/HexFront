import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const forbiddenLiterals = [
  'recruit',
  'build',
  'upgradeCity',
  'improve',
  'foundCity',
  'rebuildSupply',
  'setTax',
  'startOffensive',
  'stopOffensive',
  'infantry',
  'armor',
  'artillery',
  'fort',
  'depot',
];

function sourceOf(file: string): string {
  return readFileSync(new URL(`../../src/bots/${file}`, import.meta.url), 'utf8');
}

function simSourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(`${entry.name}/`, directory);
    if (entry.isDirectory()) return simSourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('страж мозга бота', () => {
  it('не знает виды команд, юнитов, построек и balance.ts', () => {
    for (const file of ['brain.ts', 'actions.ts', 'features.ts']) {
      const source = sourceOf(file);
      expect(source).not.toMatch(/from ['"](?:\.\.\/)+balance\.ts['"]/);
      for (const literal of forbiddenLiterals) {
        expect(source).not.toMatch(new RegExp(`['"]${literal}['"]`));
      }
    }
  });

  it('не содержит удалённых констант мозга в исходниках sim', () => {
    const pattern =
      /BOT_TAX_PEACE|BOT_TAX_WAR|BOT_ATTACK_MIN_RATIO|BOT_ATTACK_STOP_RATIO|BOT_MAX_SPENDS|BOT_GOLD_RESERVE|BOT_EASY_TAX/;
    for (const file of simSourceFiles(new URL('../../src/', import.meta.url))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(pattern);
    }
  });
});
