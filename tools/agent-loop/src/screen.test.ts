import { describe, expect, it } from 'vitest';

import { Board, MAIN_AGENT } from './board.ts';
import { parseKey } from './console-ui.ts';
import { waitActions } from './owner-actions.ts';
import { clean, duration, fit, wrap } from './screen-text.ts';
import { describeWork, lineColor, MIN_HEIGHT, MIN_WIDTH, renderFrame } from './screen.ts';

// Ширина кадра — в видимых клетках: цвет не занимает места.
const ESCAPE = String.fromCharCode(27);
const plain = (text: string): string =>
  text
    .split(`${ESCAPE}[`)
    .map((part, index) => (index === 0 ? part : part.replace(/^[\d;]*m/u, '')))
    .join('');
const cells = (text: string): number => Array.from(plain(text)).length;

function sampleBoard(): { board: Board; advance: (ms: number) => void } {
  let now = Date.UTC(2026, 9, 14, 6, 0, 0);
  const board = new Board(() => now);
  board.limit = () => 3;
  board.stage = {
    stage: '07',
    branch: 'stage-07',
    done: 5,
    review: 1,
    total: 18,
    next: ['07/T6', '07/T7'],
  };
  board.loopLog = '.ai-logs/agent-loop-2026-10-14.md';
  board.task(MAIN_AGENT, '07/T1');
  board.begin(MAIN_AGENT, '$task 07/T1');
  board.task('w2', '07/T4');
  board.begin('w2', 'CI 07/T4');
  return { board, advance: (ms) => (now += ms) };
}

describe('кадр консоли', () => {
  it.each([
    [60, 16],
    [80, 24],
    [100, 30],
    [180, 50],
  ])('ровно %i×%i клеток, с цветом и без', (width, height) => {
    const { board } = sampleBoard();
    board.wait('w2', `очень длинная причина ${'x'.repeat(300)}`);
    for (let index = 0; index < 80; index += 1)
      board.log(`[w2 07/T4] строка ${index} ${'ж'.repeat(200)}`);
    for (const colors of [true, false]) {
      const lines = renderFrame(board, width, height, colors);
      expect(lines).toHaveLength(height);
      for (const line of lines) expect(cells(line)).toBe(width);
    }
  });

  it('рамка сверху и снизу, разделы по порядку', () => {
    const { board } = sampleBoard();
    const lines = renderFrame(board, 100, 30, false);
    expect(lines[0]).toMatch(
      /^╭─ HexFront · агентный цикл ─+ этап 07 · stage-07 · \d\d:\d\d:\d\d ─╮$/u,
    );
    expect(lines.at(-1)).toMatch(/^╰─+╯$/u);
    const titles = lines.filter((line) => line.startsWith('├─ ')).map((line) => line.split(' ')[1]);
    expect(titles).toEqual(['АГЕНТЫ', 'ЭТАП', 'ЗА', 'ЖУРНАЛ']);
  });

  it('агенты: что делает словами, задача, время; пустые места потоков до предела', () => {
    const { board, advance } = sampleBoard();
    advance(12 * 60_000);
    const text = renderFrame(board, 100, 30, false).join('\n');
    expect(text).toMatch(/главный\s+07\/T1\s+● работает\s+пишет код \(\$task 07\/T1\)\s+12 мин/u);
    expect(text).toMatch(/w2\s+07\/T4\s+● работает\s+ждёт CI на GitHub/u);
    expect(text).toMatch(/w1\s+—\s+○ свободен\s+без задачи\s+│/u);
    expect(text).toMatch(/w3\s+—\s+○ свободен/u);
    expect(text).toContain('работают 2 · можно до 3 одновременно');
  });

  it('один агент — без пустых мест потоков', () => {
    const { board } = sampleBoard();
    board.limit = () => 1;
    board.remove('w2');
    const text = renderFrame(board, 100, 30, false).join('\n');
    expect(text).not.toMatch(/│ w\d/u);
  });

  it('сверху — нужен ли владелец: ожидание важнее паузы, пауза важнее «всё идёт само»', () => {
    const { board } = sampleBoard();
    expect(renderFrame(board, 100, 30, false)[1]).toContain('✓ Всё идёт само');
    board.pause('w2', 'лимит codex — повтор через 30 мин');
    expect(renderFrame(board, 100, 30, false)[1]).toContain(
      '‖ Пауза после сбоя, снимется сама: лимит codex',
    );
    board.wait(MAIN_AGENT, 'очередь дошла до 07/T5 — это задача владельца');
    expect(renderFrame(board, 100, 30, false)[1]).toContain(
      '◆ Нужен ты: главный — очередь дошла до 07/T5',
    );
    board.end(MAIN_AGENT, 'нет работы');
    board.end('w2', 'готово');
    expect(renderFrame(board, 100, 30, false)[1]).toContain('Работы сейчас нет');
  });

  it('ожидание: причина целиком в несколько строк и клавиши ответа под ней', () => {
    const { board } = sampleBoard();
    const reason =
      'красный slow (все тесты) на служебном коммите, не задаче этапа. Открой ссылку: упал сам прогон — нажми «Re-run failed jobs». Станет зелёным — цикл продолжит сам: failure job=tests https://github.com/detektor133/HexFront/actions/runs/38533518333';
    board.end(MAIN_AGENT, 'ревью', '.ai-logs/agent-loop/1.log', '/repo/.ai-logs/agent-loop/1.log');
    board.wait(MAIN_AGENT, reason, waitActions('slow:abc', reason, true, 'detektor133/HexFront'));
    const lines = renderFrame(board, 100, 30, false);
    for (const line of lines) expect(cells(line)).toBe(100);
    expect(lines[1]).toMatch(/^│ ◆ Нужен ты: главный — красный slow \(все тесты\)/u);
    expect(lines[2]).toMatch(/^│ {3}\S/u);
    expect(lines.slice(1, 4).join(' ')).toContain('actions/runs/38533518333');
    expect(lines[4]).toContain('[З] перезапуск прогона  [О] ссылка  [Л] лог сессии');
    board.end(MAIN_AGENT, 'повторяю');
    expect(renderFrame(board, 100, 30, false).join('\n')).not.toContain('[З]');
  });

  it('низкое окно с четырьмя потоками и длинным ожиданием: причина короче, низ с ответами клавиш виден', () => {
    const { board } = sampleBoard();
    board.limit = () => 4;
    for (const name of ['w1', 'w3', 'w4']) board.begin(name, `$task 07/T${name}`);
    const reason = `красный slow ${'причина '.repeat(60)} https://github.com/a/b/actions/runs/7`;
    board.wait(MAIN_AGENT, reason, waitActions('slow:abc', reason, true));
    board.notice = 'Открываю: ссылка';
    for (const height of [MIN_HEIGHT, 18, 20]) {
      const lines = renderFrame(board, 80, height, false);
      expect(lines).toHaveLength(height);
      for (const line of lines) expect(cells(line)).toBe(80);
      expect(lines.at(-1)).toMatch(/^╰─+╯$/u);
      expect(lines.at(-3)).toContain('Открываю: ссылка');
    }
    const roomy = renderFrame(board, 80, 40, false).join('\n');
    expect(roomy).toContain('[З] перезапуск прогона');
  });

  it('перенос по словам: ширина строк, длинное слово режется, лишнее — «…»', () => {
    expect(wrap('раз два три четыре', 8, 6, 5)).toEqual(['раз два', 'три', 'четыре']);
    expect(wrap('x'.repeat(10), 4, 4, 5)).toEqual(['xxxx', 'xxxx', 'xx']);
    expect(wrap('раз два три четыре пять', 7, 7, 2)).toEqual(['раз два', 'три че…']);
    expect(wrap('что угодно', 0, 0, 0)).toEqual([]);
    expect(wrap('', 10, 10, 3)).toEqual([]);
  });

  it('этап: полоса готового и ревью, дальше по очереди', () => {
    const { board } = sampleBoard();
    const text = renderFrame(board, 100, 30, false).join('\n');
    expect(text).toMatch(/\[█+▒+░+\] 5 из 18 готово · 1 на ревью · осталось 12/u);
    expect(text).toContain('Дальше: 07/T6 → 07/T7');
  });

  it('журнал показывает последние строки, многострочная запись — первой строкой', () => {
    const { board } = sampleBoard();
    for (let index = 0; index < 50; index += 1) board.log(`строка ${index}`);
    board.log('← $review 07/T1: ВОЗВРАТ\n- нет теста');
    const text = renderFrame(board, 100, 30, false).join('\n');
    expect(text).toContain('строка 49');
    expect(text).toContain('← $review 07/T1: ВОЗВРАТ');
    expect(text).not.toContain('- нет теста');
    expect(text).not.toContain('строка 10 ');
  });

  it('низкое окно: раздел этапа уступает журналу, рамка цела', () => {
    const { board } = sampleBoard();
    const lines = renderFrame(board, 80, MIN_HEIGHT, false);
    expect(lines).toHaveLength(MIN_HEIGHT);
    expect(lines.join('\n')).not.toContain('ЭТАП');
    expect(lines.at(-1)).toMatch(/^╰/u);
  });

  it('слишком маленькое окно — просьба увеличить, без рамки', () => {
    const { board } = sampleBoard();
    const lines = renderFrame(board, MIN_WIDTH - 1, 10, false);
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain('мало');
    for (const line of lines) expect(cells(line)).toBe(MIN_WIDTH - 1);
  });

  it('просьба о числе агентов видна до применения', () => {
    const { board } = sampleBoard();
    board.requestLimit(4);
    const text = renderFrame(board, 100, 30, false).join('\n');
    expect(text).toContain('→ станет 4');
    expect(text).toContain('Агентов станет 4, как только цикл закончит текущий шаг');
    board.notice = 'Проверяю Issues и main сейчас';
    expect(renderFrame(board, 100, 30, false).join('\n')).toContain(
      'Проверяю Issues и main сейчас',
    );
  });

  it('NO_COLOR: без escape-последовательностей', () => {
    const { board } = sampleBoard();
    expect(renderFrame(board, 100, 30, false).join('')).not.toContain('\u001b');
    expect(renderFrame(board, 100, 30, true).join('')).toContain('\u001b[');
  });
});

describe('кадр с грязным текстом', () => {
  it('цвет, \\r, табуляция и эмодзи из вывода codex не ломают рамку', () => {
    const { board } = sampleBoard();
    const escape = String.fromCharCode(27);
    board.log(`${escape}[31mкрасный${escape}[0m\tтаб\rвозврат 🎉 中文 é`);
    board.wait('w2', `${escape}[1mжирный${escape}[0m\tвопрос`);
    for (const width of [60, 61, 80, 100]) {
      const lines = renderFrame(board, width, 30, false);
      for (const line of lines) {
        expect(cells(line)).toBe(width);
        expect(line).not.toContain(escape);
        expect(line).not.toContain('\r');
        expect(line).not.toContain('\t');
      }
    }
  });

  it('длинный заголовок раздела и просьба о числе агентов не выходят за ширину', () => {
    const { board } = sampleBoard();
    board.loopLog = `.ai-logs/${'очень-длинный-путь/'.repeat(10)}agent-loop.md`;
    board.limit = () => 1;
    board.requestLimit(2);
    for (const width of [60, 61, 62, 70, 100]) {
      const lines = renderFrame(board, width, 30, true);
      for (const line of lines) expect(cells(line)).toBe(width);
      expect(plain(lines.find((line) => line.includes('ЖУРНАЛ')) ?? '')).toMatch(/…┤$/u);
    }
  });

  it('время в часах помещается в столбец', () => {
    const { board, advance } = sampleBoard();
    advance((10 * 60 + 5) * 60_000);
    expect(renderFrame(board, 100, 30, false).join('\n')).toContain('10 ч 05 мин');
  });

  it('внизу — лог последней сессии codex', () => {
    const { board } = sampleBoard();
    board.end('w2', 'готово', '.ai-logs/agent-loop/w2.log');
    expect(renderFrame(board, 100, 30, false).join('\n')).toContain(
      'Лог последней сессии codex: w2 .ai-logs/agent-loop/w2.log',
    );
  });

  it('clean: одна клетка на символ', () => {
    const escape = String.fromCharCode(27);
    expect(clean(`${escape}[1;31mок${escape}[0m`)).toBe('ок');
    expect(clean('a\tb\r\nc')).toBe('a bc');
    expect(clean('🎉中')).toBe('??');
    expect(clean('ждёт')).toBe('ждёт');
  });
});

describe('слова и форматы экрана', () => {
  it('команда скилла — словами', () => {
    expect(describeWork('$task 07/T1 продолжить')).toBe('доделывает прерванную работу');
    expect(describeWork('$task 07/T1 CI красный: test')).toBe('чинит красный CI');
    expect(describeWork('$task 07/T1 слияние: влей')).toBe('разрешает конфликт слияния');
    expect(describeWork('$next')).toBe('пишет код');
    expect(describeWork('$task 07/T1')).toBe('пишет код');
    expect(describeWork('$review 07/T1')).toBe('ревью задачи');
    expect(describeWork('$spec 07/T1')).toBe('пишет приёмочные тесты');
    expect(describeWork('$stage-close')).toBe('закрывает этап');
    expect(describeWork('CI 07/T1')).toBe('ждёт CI на GitHub');
    expect(describeWork('slow 07/T1')).toBe('ждёт полные тесты (slow)');
    expect(describeWork('$decide')).toBe('выполняет $decide');
    expect(describeWork('push 07/T1')).toBe('push 07/T1');
  });

  it('длительность: минуты, затем часы', () => {
    expect(duration(-5)).toBe('0 мин');
    expect(duration(59 * 60_000 + 59_999)).toBe('59 мин');
    expect(duration(65 * 60_000)).toBe('1 ч 05 мин');
  });

  it('fit: кириллица считается по символу, длинное — с многоточием', () => {
    expect(fit('ждёт', 6)).toBe('ждёт  ');
    expect(fit('работает', 5)).toBe('рабо…');
    expect(fit('x', 0)).toBe('');
    expect(fit('xy', 1)).toBe('…');
  });

  it('цвет журнала: ошибки красные, ожидание владельца жёлтое, готовое зелёное', () => {
    expect(lineColor('ошибка: нет STATUS')).toBe('red');
    expect(lineColor('[w1 07/T2] CI красный за 1 мин: failure')).toBe('red');
    expect(lineColor('[w2 07/T3] жду: вопрос')).toBe('yellow');
    expect(lineColor('готово: 07/T1')).toBe('green');
    expect(lineColor('→ $next (новая сессия codex)')).toBeUndefined();
    // «жду CI» — работа, а не ожидание владельца.
    expect(lineColor('… жду CI перед $review 07/T2')).toBeUndefined();
  });
});

describe('клавиши консоли', () => {
  it('число агентов, проверка и выход — в обеих раскладках', () => {
    expect(parseKey('+', 2)).toEqual({ kind: 'limit', value: 3 });
    expect(parseKey('=', 2)).toEqual({ kind: 'limit', value: 3 });
    expect(parseKey('-', 2)).toEqual({ kind: 'limit', value: 1 });
    expect(parseKey('3', 1)).toEqual({ kind: 'limit', value: 3 });
    expect(parseKey('\r', 1)).toEqual({ kind: 'wake' });
    expect(parseKey('к', 1)).toEqual({ kind: 'wake' });
    expect(parseKey('q', 1)).toEqual({ kind: 'quit', force: false });
    expect(parseKey('й', 1)).toEqual({ kind: 'quit', force: false });
    expect(parseKey('\u0003', 1)).toEqual({ kind: 'quit', force: true });
  });

  it('вставленный текст — не команда, даже с двумя «й»; Ctrl+C в куске — выход', () => {
    expect(parseKey('йй', 1)).toBeUndefined();
    expect(parseKey('привет, мой', 1)).toBeUndefined();
    expect(parseKey('\r\n', 1)).toEqual({ kind: 'wake' });
    expect(parseKey('ab\u0003', 1)).toEqual({ kind: 'quit', force: true });
  });

  it('остальное — не команда: 0, 5 и буквы', () => {
    expect(parseKey('0', 1)).toBeUndefined();
    expect(parseKey('5', 1)).toBeUndefined();
    expect(parseKey('x', 1)).toBeUndefined();
  });
});
