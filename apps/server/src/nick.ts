// Ник игрока: длина, допустимые символы, простой словарь нецензурных корней (ru/en).
import { NICK_MAX, NICK_MIN } from '@hexfront/protocol';

// Корни хранятся латиницей и кириллицей, сравнение — после нормализации похожих символов.
const BAD_ROOTS: readonly string[] = [
  'хуй',
  'хуе',
  'хуя',
  'пизд',
  'ебат',
  'ебан',
  'ебал',
  'ебну',
  'блят',
  'бляд',
  'сука',
  'суки',
  'мудак',
  'мудил',
  'пидор',
  'пидар',
  'гандон',
  'залуп',
  'шлюх',
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigg',
  'fagg',
  'whore',
  'dick',
  'cock',
  'pussy',
  'rape',
  'nazi',
  'hitler',
];

// Латиница и цифры, которыми обычно маскируют русские буквы.
const LOOKALIKE: Readonly<Record<string, string>> = {
  a: 'а',
  b: 'в',
  c: 'с',
  e: 'е',
  h: 'н',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  t: 'т',
  x: 'х',
  y: 'у',
  '0': 'о',
  '3': 'е',
  '4': 'а',
  '@': 'а',
  ё: 'е',
};

function fold(text: string, latin: boolean): string {
  let out = '';
  for (const ch of text.toLowerCase()) {
    if (!/[\p{L}\p{N}@]/u.test(ch)) continue;
    out += latin ? ch : (LOOKALIKE[ch] ?? ch);
  }
  return out;
}

/** Есть ли в нике нецензурный корень, в том числе замаскированный. */
export function isProfane(nick: string): boolean {
  const plain = fold(nick, true);
  const cyrillic = fold(nick, false);
  return BAD_ROOTS.some((root) => plain.includes(root) || cyrillic.includes(root));
}

/**
 * Проверяет и приводит ник к виду для комнаты.
 * @returns очищенный ник или `null`, если ник не подходит
 */
export function sanitizeNick(raw: string): string | null {
  // Управляющие символы и пробельные повторы не нужны; оставляем буквы, цифры и мягкую пунктуацию.
  const nick = raw
    .normalize('NFKC')
    .replace(/[\p{C}\p{Z}]+/gu, ' ')
    .trim();
  if (nick.length < NICK_MIN || nick.length > NICK_MAX) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(nick)) return null;
  if (isProfane(nick)) return null;
  return nick;
}
