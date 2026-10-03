// CLI для CI: проверяет коммиты диапазона `<base>..<head>` в ветке `<branch>`.
// Запуск: node --experimental-strip-types tools/commit-check/src/cli.ts <base> <head> <branch>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { checkCommitMessage } from './commit-check.ts';

// Режим commit-msg хука: `cli.ts --msg <файл сообщения>` — проверяется одно сообщение, файлы —
// из индекса, ветка — текущая.
if (process.argv[2] === '--msg') {
  const file = process.argv[3];
  if (!file) {
    console.error('usage: cli.ts --msg <file>');
    process.exit(2);
  }
  const message = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n');
  // Служебные сообщения git (merge, revert, fixup) формату не подчиняются, как и в диапазонном режиме.
  if (/^(Merge|Revert|fixup!|squash!)/.test(message)) process.exit(0);
  const out = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const files = out(['diff', '--cached', '--name-only'])
    .split('\n')
    .filter((f) => f !== '');
  const errors = checkCommitMessage(message, {
    branch: out(['rev-parse', '--abbrev-ref', 'HEAD']),
    files,
  });
  for (const e of errors) console.error(`commit-msg: ${e}`);
  process.exit(errors.length > 0 ? 1 : 0);
}

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
  const files = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', sha], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f !== '');
  const errors = checkCommitMessage(rest.join('\n'), { branch, files, sha });
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
