import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lang } from '../src/i18n/dict.ts';
import { applyDocumentLang } from '../src/i18n/document-lang.ts';

// В jsdom-проекте import.meta.url не file:, как и в других .dom.test.tsx — путь от корня.
const MAIN = readFileSync(join(process.cwd(), 'apps/client/src/main.tsx'), 'utf8');

describe('язык документа', () => {
  it('критерий приёмки: document.documentElement.lang равен языку i18n', () => {
    document.documentElement.lang = lang === 'ru' ? 'en' : 'ru';

    applyDocumentLang(document.documentElement);

    expect(document.documentElement.lang).toBe(lang);
  });

  it('оболочка ставит язык документа до рендера приложения', () => {
    const call = MAIN.indexOf('applyDocumentLang(document.documentElement)');

    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(MAIN.indexOf('createRoot('));
  });
});
