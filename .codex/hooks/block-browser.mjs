// PreToolUse-хук: запрещает ручной браузер; разрешает только проектные автоматические команды.
import { readFileSync } from 'node:fs';

let event = {};
try {
  const raw = readFileSync(0, 'utf8');
  event = raw.trim() === '' ? {} : JSON.parse(raw);
} catch (err) {
  process.stderr.write(`block-browser: не удалось разобрать вход хука: ${String(err)}\n`);
  process.exit(0);
}

const input = event.tool_input ?? {};
const command =
  typeof input === 'string'
    ? input
    : JSON.stringify({ ...input, command: input.command ?? input.cmd ?? '' });
const forbidden = [
  /\bpnpm\s+(run\s+)?dev\b/,
  /\bnpx\s+playwright\b/,
  /(^|[\s"'])playwright\s+(test|open|codegen|show-report)\b/,
  /\bvite(\s|"|$)/,
];

const automated = /\bpnpm\s+(?:run\s+)?(?:probe:memory|test:e2e(?::layout)?)\b/.test(command);
const hit = automated ? undefined : forbidden.find((re) => re.test(command));
if (hit) {
  process.stderr.write(
    'Запрещено правилами проекта: ручной dev-сервер и Playwright. ' +
      'Используй pnpm test:e2e:layout или pnpm probe:memory.\n',
  );
  process.exit(2);
}

const searchCommand = /(^|[\s"'|;&])(?:rg|grep|Select-String)(?=\s|$)/i.test(command);
if (searchCommand) {
  const contextValues = [
    ...command.matchAll(/(?:^|[\s])-(?:C|A|B)(?:\s+|=)?(\d+)/gi),
    ...command.matchAll(/(?:^|[\s])--context(?:\s+|=)(\d+)/gi),
    ...command.matchAll(/(?:^|[\s])-Context(?:\s+|=)([\d,]+)/gi),
  ].flatMap((match) => match[1].split(',').map(Number));
  if (contextValues.some((value) => value > 3)) {
    process.stderr.write(
      'Поиск отклонён: контекст не больше 3. Используй -C2/-A2/-B2 или -Context 2,2.\n',
    );
    process.exit(2);
  }

  const hasFileOrCountLimit =
    /(?:^|[\s])(?:-l|-c|--files(?:-with-matches)?|--count)(?:\s|$|=)/i.test(command);
  const limitMatch = command.match(/(?:\|\s*)?(?:Select-Object\s+-First|head\s+-n)\s+(\d+)/i);
  if (!hasFileOrCountLimit && limitMatch === null) {
    process.stderr.write(
      'Поиск отклонён: нужен -l/-c/--files/--count или лимит | Select-Object -First N/head -n N.\n',
    );
    process.exit(2);
  }
  if (limitMatch !== null && Number(limitMatch[1]) > 80) {
    process.stderr.write(
      'Поиск отклонён: лимит вывода не больше 80. Используй -First 80 или меньше.\n',
    );
    process.exit(2);
  }
}
process.exit(0);
