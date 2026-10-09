import { readFileSync } from 'node:fs';

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
    const source = readFileSync(new URL('../../src/balance.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(
      /BOT_TAX_PEACE|BOT_TAX_WAR|BOT_ATTACK_MIN_RATIO|BOT_ATTACK_STOP_RATIO|BOT_MAX_SPENDS|BOT_GOLD_RESERVE|BOT_EASY_TAX/,
    );
  });
});
