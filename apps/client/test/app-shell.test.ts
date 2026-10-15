import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface Tokens {
  readonly ui: {
    readonly ink: string;
    readonly surface: string;
  };
}

const DIST_DIRECTORY = fileURLToPath(new URL('../dist/', import.meta.url));
const PUBLIC_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url));
const TOKENS_PATH = fileURLToPath(new URL('../../../docs/art/tokens.json', import.meta.url));
const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as Tokens;

function readDistFile(name: string): string {
  const path = join(DIST_DIRECTORY, name);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function readPngDimensions(path: string): { readonly width: number; readonly height: number } {
  if (!existsSync(path)) return { width: 0, height: 0 };

  const png = readFileSync(path);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

describe('оболочка страницы', () => {
  it('критерий приёмки: в dist есть SVG, PNG 192 и 512, манифест с полями и theme-color из токена', () => {
    const indexHtml = readDistFile('index.html');
    const manifest = readDistFile('manifest.webmanifest');

    expect(existsSync(`${DIST_DIRECTORY}/icon.svg`)).toBe(true);
    expect(existsSync(`${DIST_DIRECTORY}/icon-192.png`)).toBe(true);
    expect(existsSync(`${DIST_DIRECTORY}/icon-512.png`)).toBe(true);
    expect(manifest).toContain('"name":"Hexfront"');
    expect(manifest).toContain('"display":"standalone"');
    expect(manifest).toContain('"start_url":"/"');
    expect(indexHtml).toContain(`<meta name="theme-color" content="${tokens.ui.surface}"`);
  });

  it('критерий приёмки: icon.svg содержит ровно фигуры H и цвета токенов', () => {
    const icon = existsSync(`${DIST_DIRECTORY}/icon.svg`)
      ? readFileSync(`${DIST_DIRECTORY}/icon.svg`, 'utf8')
      : '';
    const tags = icon.match(/<([a-z]+)\b[^>]*\/?>(?:<\/\1>)?/giu) ?? [];

    expect(icon).toContain('viewBox="0 0 64 64"');
    expect(tags.filter((tag) => tag.startsWith('<rect'))).toHaveLength(1);
    expect(tags.filter((tag) => tag.startsWith('<line'))).toHaveLength(3);
    expect(tags.every((tag) => /<(?:svg|rect|line)\b/iu.test(tag))).toBe(true);
    expect(icon).toContain(
      `<rect x="0" y="0" width="64" height="64" rx="12" fill="${tokens.ui.surface}"`,
    );
    expect(icon).toContain(
      `<line x1="20" y1="16" x2="20" y2="48" stroke="${tokens.ui.ink}" stroke-width="8" stroke-linecap="round"`,
    );
    expect(icon).toContain(
      `<line x1="44" y1="16" x2="44" y2="48" stroke="${tokens.ui.ink}" stroke-width="8" stroke-linecap="round"`,
    );
    expect(icon).toContain(
      `<line x1="20" y1="32" x2="44" y2="32" stroke="${tokens.ui.ink}" stroke-width="8" stroke-linecap="round"`,
    );
  });

  it('критерий приёмки: ширина и высота PNG из заголовка IHDR — 192 и 512', () => {
    const icon192 = readPngDimensions(`${DIST_DIRECTORY}/icon-192.png`);
    const icon512 = readPngDimensions(`${DIST_DIRECTORY}/icon-512.png`);

    expect(icon192).toEqual({ width: 192, height: 192 });
    expect(icon512).toEqual({ width: 512, height: 512 });
  });

  it('критерий задачи: исходный SVG и PNG находятся в public для копирования сборкой', () => {
    expect(existsSync(`${PUBLIC_DIRECTORY}/icon.svg`)).toBe(true);
    expect(existsSync(`${PUBLIC_DIRECTORY}/icon-192.png`)).toBe(true);
    expect(existsSync(`${PUBLIC_DIRECTORY}/icon-512.png`)).toBe(true);
  });
});
