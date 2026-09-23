// CLI для CI: проверяет коммиты диапазона `<base>..<head>` в ветке `<branch>`.
// Запуск: node --experimental-strip-types tools/commit-check/src/cli.ts <base> <head> <branch>
import { execFileSync } from 'node:child_process';

import { checkCommitMessage } from './commit-check.ts';

const [base, head, branch] = process.argv.slice(2);
if (!base || !head || !branch) {
  console.error('usage: cli.ts <base> <head> <branch>');
  process.exit(2);
}

const log = execFileSync('git', ['log', '--no-merges', '--format=%H%n%B%x00', `${base}..${head}`], {
  encoding: 'utf8',
});

let failed = 0;
for (const entry of log.split('\0')) {
  const trimmed = entry.trim();
  if (trimmed === '') continue;
  const [sha = '', ...rest] = trimmed.split('\n');
  const errors = checkCommitMessage(rest.join('\n'), { branch });
  if (errors.length > 0) {
    failed += 1;
    console.error(`${sha.slice(0, 8)}: ${rest[0] ?? ''}`);
    for (const e of errors) console.error(`  - ${e}`);
  }
}

if (failed > 0) {
  console.error(`commit-check: ${failed} commit(s) failed`);
  process.exit(1);
}
console.log('commit-check: ok');
