// Текст для кадра консоли: очистка вывода codex до клеток терминала, ширина, время.

/** Длительность для людей: «7 мин», «1 ч 05 мин». */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  if (total < 60) return `${total} мин`;
  return `${Math.floor(total / 60)} ч ${String(total % 60).padStart(2, '0')} мин`;
}

export const clockText = (ms: number): string => {
  const date = new Date(ms);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
};

/** Двойная ширина в терминале: иероглифы, хангыль, полноширинные формы, эмодзи. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
];
const isWide = (code: number): boolean => WIDE.some(([from, to]) => code >= from && code <= to);
/** Последний байт escape-последовательности CSI: `ESC [ … m` и подобных. */
const isCsiFinal = (code: number): boolean => code >= 0x40 && code <= 0x7e;

/**
 * Текст, в котором каждый символ занимает ровно одну клетку. Протокол несёт вывод codex и pnpm:
 * цвета, `\r` прогресса, табуляции и эмодзи иначе сдвинули бы рамку или стёрли её край.
 */
export function clean(text: string): string {
  let out = '';
  let escape: 'none' | 'start' | 'csi' = 'none';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (escape === 'start') escape = char === '[' ? 'csi' : 'none';
    else if (escape === 'csi') escape = isCsiFinal(code) ? 'none' : 'csi';
    else if (code === 0x1b) escape = 'start';
    else if (code === 0x09) out += ' ';
    else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue;
    else if (code >= 0x300 && code <= 0x36f) continue;
    else out += isWide(code) ? '?' : char;
  }
  return out;
}

/** Ширина в клетках очищенного текста: каждый символ занимает одну. */
export const chars = (text: string): string[] => Array.from(text);

/** Текст ровно в width клеток: длинный обрезается с «…», короткий дополняется пробелами. */
export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  const list = chars(clean(text));
  if (list.length > width) return `${list.slice(0, width - 1).join('')}…`;
  return list.join('') + ' '.repeat(width - list.length);
}
