import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const hudCss = readFileSync(join(process.cwd(), 'apps/client/src/dev/Hud.module.css'), 'utf8');
const uiDoc = readFileSync(join(process.cwd(), 'docs/art/ui.md'), 'utf8');
const styleGuide = readFileSync(join(process.cwd(), 'docs/art/style-guide.md'), 'utf8');

function cssBlock(selector: string): string {
  const start =
    selector === '.taxButton'
      ? hudCss.indexOf('\n.taxButton {\n  /* Подпись')
      : hudCss.indexOf(`\n${selector} {`);
  if (start < 0) return '';
  const end = hudCss.indexOf('\n}', start);
  return hudCss.slice(start, end < 0 ? hudCss.length : end);
}

describe('07/T17aa: HUD без переполнения', () => {
  it('ограничивает содержимое всех пяти слотов и отдельно проверяет налог', () => {
    expect(hudCss.match(/\.hud > \.slot/g)).toHaveLength(1);
    expect(hudCss).toMatch(/\.slot,\s*\.taxButton\s*\{/);
    expect(cssBlock('.slotText')).toContain('overflow: hidden;');
    expect(cssBlock('.slotText')).toContain('text-overflow: ellipsis;');
    expect(cssBlock('.slotText')).toContain('min-width: 0;');

    const taxButton = cssBlock('.taxButton');
    expect(taxButton).toContain('border: 0;');
    expect(taxButton).toContain('border-radius: 0;');
    expect(taxButton).toContain('background: none;');
  });

  it('использует единый интерактивный класс и фиксирует стратегию в документации', () => {
    expect(hudCss).toMatch(/\.hudInteractive:hover\s*\{[\s\S]*?background: var\(--ui-surface2\);/);
    expect(hudCss).toMatch(
      /\.hudInteractive:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--selection-color\);/,
    );
    expect(uiDoc).toContain('длинные значения сокращаются многоточием внутри слота');
    expect(styleGuide).toContain('налога использует общий интерактивный класс HUD');
  });
});
