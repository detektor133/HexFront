// Генерация apps/client/src/theme/tokens.{ts,css} из docs/art/tokens.json — единственного источника
// цветов и размеров (AGENTS.md §7). Ключи на `$` — комментарии, в вывод не попадают.

export type TokenValue = string | number | TokenValue[] | { [key: string]: TokenValue };

const HEADER = 'Сгенерировано tools/tokens из docs/art/tokens.json — не редактировать вручную.';

// Эти группы — CSS-размеры в px; остальные числа (альфа, толщины на карте, веса) — без единиц.
const PX_PATHS = ['radius', 'space', 'font-size', 'touch-target-min'];

function strip(value: TokenValue): TokenValue {
  if (Array.isArray(value)) return value.map(strip);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !k.startsWith('$'))
      .map(([k, v]) => [k, strip(v)]),
  );
}

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function flatten(value: TokenValue, path: string[], out: [string, string][]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      const key =
        typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string'
          ? v.id
          : String(i + 1);
      flatten(v, [...path, key], out);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value))
      if (k !== 'id') flatten(v, [...path, kebab(k)], out);
    return;
  }
  const name = path.join('-');
  const px = typeof value === 'number' && PX_PATHS.some((p) => name.startsWith(p));
  const css = typeof value === 'number' ? `${value}${px ? 'px' : ''}` : cssString(name, value);
  out.push([name, css]);
}

function cssString(name: string, value: string): string {
  return name.endsWith('family') ? `'${value}'` : value;
}

/** TypeScript-модуль с объектом токенов. */
export function renderTs(raw: TokenValue): string {
  const body = JSON.stringify(strip(raw), null, 2);
  return `// ${HEADER}\n\nexport const tokens = ${body} as const;\n`;
}

/** CSS с custom properties на :root. */
export function renderCss(raw: TokenValue): string {
  const vars: [string, string][] = [];
  flatten(strip(raw), [], vars);
  const lines = vars.map(([k, v]) => `  --${k}: ${v};`).join('\n');
  return `/* ${HEADER} */\n\n:root {\n${lines}\n}\n`;
}

function channel(hex: string, offset: number): number {
  const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Относительная яркость цвета #RRGGBB по WCAG 2.x. */
export function luminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`не цвет #RRGGBB: ${hex}`);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** Контраст двух цветов по WCAG 2.x, от 1 до 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
