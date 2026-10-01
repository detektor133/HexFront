// PreToolUse-хук: запрещает ручной запуск dev-сервера и Playwright.
// Скрипты pnpm visual / pnpm verify вызывают Playwright сами и не блокируются.
import { readFileSync } from 'node:fs';

let event = {};
try {
  const raw = readFileSync(0, 'utf8');
  event = raw.trim() === '' ? {} : JSON.parse(raw);
} catch (err) {
  process.stderr.write(`block-browser: не удалось разобрать вход хука: ${String(err)}\n`);
  process.exit(0);
}

const command = JSON.stringify(event.tool_input ?? {});
const forbidden = [
  /\bpnpm\s+(run\s+)?dev\b/,
  /\bnpx\s+playwright\b/,
  /(^|[\s"'])playwright\s+(test|open|codegen|show-report)\b/,
  /\bvite(\s|"|$)/,
];

const hit = forbidden.find((re) => re.test(command));
if (hit) {
  process.stderr.write(
    'Запрещено правилами проекта: ручной dev-сервер и Playwright. ' +
      'Проверяй через pnpm verify / pnpm visual и читай их текстовый вывод.\n',
  );
  process.exit(2);
}
process.exit(0);
