// Запуск: node --experimental-strip-types tools/tokens/src/cli.ts [--check]
// --check не пишет файлы, а падает, если сгенерированные файлы устарели.
import { readFileSync, writeFileSync } from 'node:fs';

import { renderCss, renderTs, type TokenValue } from './generate.ts';

const root = new URL('../../../', import.meta.url);
const source = JSON.parse(
  readFileSync(new URL('docs/art/tokens.json', root), 'utf8'),
) as TokenValue;
const outputs: [URL, string][] = [
  [new URL('apps/client/src/theme/tokens.ts', root), renderTs(source)],
  [new URL('apps/client/src/theme/tokens.css', root), renderCss(source)],
];

const check = process.argv.includes('--check');
let stale = 0;
for (const [file, content] of outputs) {
  if (!check) {
    writeFileSync(file, content);
    continue;
  }
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`tokens: cannot read ${file.pathname}: ${String(error)}`);
  }
  if (current !== content) {
    stale += 1;
    console.error(`tokens: ${file.pathname} is stale, run pnpm tokens`);
  }
}
if (stale > 0) process.exit(1);
console.log(check ? 'tokens: up to date' : 'tokens: generated');
