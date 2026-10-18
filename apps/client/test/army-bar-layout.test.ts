import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const CSS = new URL('../src/dev/ArmyBar.module.css', import.meta.url);

describe('область событий панели армий', () => {
  it('растянутая полоса не перехватывает свободную карту', async () => {
    const css = await readFile(CSS, 'utf8');
    const strip =
      [...css.matchAll(/\.strip\s*\{([^}]*)\}/g)]
        .map((match) => match[1] ?? '')
        .find((block) => block.includes('align-self')) ?? '';
    expect(strip).toMatch(/align-self:\s*stretch/);
    expect(strip).toMatch(/max-width:\s*100%/);
    expect(strip).toMatch(/pointer-events:\s*none/);
  });

  it('растягивает scroll-контейнер, но оставляет пустую область прозрачной для карты', async () => {
    const css = await readFile(CSS, 'utf8');
    const strip =
      [...css.matchAll(/\.strip\s*\{([^}]*)\}/g)]
        .map((match) => match[1] ?? '')
        .find((block) => block.includes('align-self')) ?? '';
    const content = css.match(/\.stripContent\s*\{([^}]*)\}/)?.[1] ?? '';
    const card = css.match(/\.card\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(strip).toMatch(/align-self:\s*stretch/);
    expect(strip).toMatch(/pointer-events:\s*none/);
    expect(content).toMatch(/width:\s*max-content/);
    expect(content).toMatch(/pointer-events:\s*auto/);
    expect(card).toMatch(/box-sizing:\s*border-box/);
    expect(card).toMatch(/flex:\s*0\s+0\s+238px/);
  });
});
