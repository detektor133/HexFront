// base64 и битсеты для формата карты. Своя реализация: sim не опирается на API среды (atob, Buffer).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

/**
 * Кодирует байты в base64 с дополнением `=`.
 * @returns строка base64
 */
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return out;
}

/**
 * Декодирует base64; `null`, если строка некорректна.
 * @returns байты или null
 */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const body = text.slice(0, text.length - pad);
  const out = new Uint8Array((text.length >> 2) * 3 - pad);
  let bits = 0;
  let acc = 0;
  let pos = 0;
  for (const ch of body) {
    const v = LOOKUP.get(ch);
    if (v === undefined) return null;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos] = (acc >> bits) & 0xff;
      pos += 1;
    }
  }
  return out;
}

/**
 * Упаковывает массив 0/1 в битсет: бит i — в байте i >> 3, младший бит первый.
 * @returns байты битсета длиной ⌈n / 8⌉
 */
export function packBits(flags: Uint8Array): Uint8Array {
  const out = new Uint8Array((flags.length + 7) >> 3);
  flags.forEach((f, i) => {
    if (f !== 0) out[i >> 3] = (out[i >> 3] ?? 0) | (1 << (i & 7));
  });
  return out;
}

/**
 * Распаковывает битсет в массив 0/1 длиной `count`.
 * @returns массив флагов
 */
export function unpackBits(bytes: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) out[i] = ((bytes[i >> 3] ?? 0) >> (i & 7)) & 1;
  return out;
}
