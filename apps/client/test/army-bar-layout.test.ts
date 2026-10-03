import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const CSS = new URL('../src/dev/ArmyBar.module.css', import.meta.url);

describe('область событий панели армий', () => {
  it('полоса не растягивает hit-area на свободную карту', async () => {
    const css = await readFile(CSS, 'utf8');
    const strip =
      [...css.matchAll(/\.strip\s*\{([^}]*)\}/g)]
        .map((match) => match[1] ?? '')
        .find((block) => block.includes('align-self')) ?? '';
    expect(strip).toMatch(/align-self:\s*flex-start/);
    expect(strip).toMatch(/max-width:\s*100%/);
  });
});
