// PreToolUse-хук: агент не останавливает процессы. На ПК владельца рядом работают агентный цикл
// (node, который запустил эту сессию) и другие сессии; 2026-10-13 codex убил цикл через
// Stop-Process, приняв его за зависший. Свою зависшую команду обрывает её собственный таймаут.
import { readFileSync } from 'node:fs';

let event = {};
try {
  const raw = readFileSync(0, 'utf8');
  event = raw.trim() === '' ? {} : JSON.parse(raw);
} catch (err) {
  process.stderr.write(`block-kill: не удалось разобрать вход хука: ${String(err)}\n`);
  process.exit(0);
}

const input = event.tool_input ?? {};
const command =
  typeof input === 'string' ? input : String(input.command ?? input.cmd ?? JSON.stringify(input));
const forbidden = [
  /\bStop-Process\b/i,
  /\bspps\b/i,
  /\b(?:taskkill|pkill|killall)\b/i,
  /\bkill\s+(?:-\S+\s+)*%?\d/i,
  /\.Kill\(\s*\)/,
];

if (forbidden.some((re) => re.test(command))) {
  process.stderr.write(
    'Запрещено правилами проекта: останавливать процессы (Stop-Process, taskkill, kill). ' +
      'Рядом работают агентный цикл и другие сессии. Длинную команду запускай с таймаутом; ' +
      'если что-то мешает работе — остановись и опиши это в отчёте.\n',
  );
  process.exit(2);
}
process.exit(0);
