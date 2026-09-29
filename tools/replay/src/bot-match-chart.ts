// Графики полного матча ботов (04/T24) для отчёта: солдаты в армиях и золото по времени у каждого
// игрока — два графика (разный масштаб, одна ось на график), цвет линии — цвет игрока на карте,
// подпись игрока на конце линии, легенда; рядом — таблица CSV.
// Запуск: pnpm --filter @hexfront/replay bot-match-chart <результат bot-match.json>
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const tokens = JSON.parse(readFileSync(new URL('docs/art/tokens.json', root), 'utf8')) as {
  ui: { ink: string; ink2: string; ink3: string; border: string; surface: string };
  players: { palette: { line: string }[] };
};
const input = process.argv[2];
if (!input) throw new Error('нужен путь к результату bot-match');

interface Sample {
  readonly t: number;
  readonly players: readonly {
    soldiers: number;
    gold: number;
    units: number;
    hexes: number;
    cities: number;
    alive: boolean;
  }[];
}
const match = JSON.parse(readFileSync(input, 'utf8')) as {
  winner: number;
  endS: number;
  samples: Sample[];
};
const OUT = new URL('docs/reports/stage-04/', root);

const W = 760;
const H = 320;
const PAD = { l: 64, r: 56, t: 60, b: 40 };
const FONT = `font-family="Golos Text, sans-serif"`;

// «Круглый» шаг оси: 1, 2 или 5 × 10^k, чтобы делений было 4–6.
function niceStep(max: number): number {
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}

const fmt = (v: number): string => v.toLocaleString('ru-RU').replace(/\u00a0/g, ' ');

function chart(title: string, key: 'soldiers' | 'gold', unit: string): string {
  const n = match.samples[0]?.players.length ?? 0;
  const maxT = match.endS;
  const maxV = Math.max(1, ...match.samples.flatMap((s) => s.players.map((p) => p[key])));
  const step = niceStep(maxV);
  const top = Math.ceil(maxV / step) * step;
  const x = (t: number): number => PAD.l + (t / maxT) * (W - PAD.l - PAD.r);
  const y = (v: number): number => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${tokens.ui.surface}"/>`);
  parts.push(
    `<text x="${PAD.l}" y="22" ${FONT} font-size="14" font-weight="500" fill="${tokens.ui.ink}">${title}</text>`,
  );
  for (let v = 0; v <= top; v += step) {
    parts.push(
      `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" stroke="${tokens.ui.border}" stroke-width="1"/>`,
      `<text x="${PAD.l - 8}" y="${y(v) + 4}" ${FONT} font-size="11" text-anchor="end" fill="${tokens.ui.ink2}">${fmt(v)}</text>`,
    );
  }
  for (let m = 0; m * 60 <= maxT; m += 5) {
    parts.push(
      `<text x="${x(m * 60)}" y="${H - PAD.b + 18}" ${FONT} font-size="11" text-anchor="middle" fill="${tokens.ui.ink2}">${m}:00</text>`,
    );
  }
  parts.push(
    `<text x="${W - PAD.r}" y="${H - 6}" ${FONT} font-size="11" text-anchor="end" fill="${tokens.ui.ink3}">время матча, мин · ${unit}</text>`,
  );
  // Линии: пока игрок жив; подпись — на конце, раздвинутая по вертикали, чтобы не слипалась.
  const ends: { id: number; y: number; x: number }[] = [];
  for (let p = 0; p < n; p += 1) {
    const color = tokens.players.palette[p]?.line ?? tokens.ui.ink;
    const pts = match.samples
      .filter((s) => s.players[p]?.alive)
      .map((s) => `${x(s.t).toFixed(1)},${y(s.players[p]?.[key] ?? 0).toFixed(1)}`);
    parts.push(
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    const last = pts.at(-1)?.split(',').map(Number);
    if (last) ends.push({ id: p, x: last[0] ?? 0, y: last[1] ?? 0 });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i += 1) {
    const prev = ends[i - 1];
    const cur = ends[i];
    if (prev && cur && cur.y - prev.y < 12) cur.y = prev.y + 12;
  }
  // Нижняя подпись не заходит под ось: весь столбик подписей поднимается.
  const over = (ends.at(-1)?.y ?? 0) - (H - PAD.b - 4);
  if (over > 0) for (const e of ends) e.y -= over;
  for (const e of ends) {
    const tag = e.id === match.winner ? ' ★' : '';
    parts.push(
      `<text x="${e.x + 6}" y="${e.y + 4}" ${FONT} font-size="11" fill="${tokens.ui.ink}">P${e.id + 1}${tag}</text>`,
    );
  }
  // Легенда: цвет игрока + подпись текстовыми чернилами.
  for (let p = 0; p < n; p += 1) {
    const lx = PAD.l + p * 64;
    const color = tokens.players.palette[p]?.line ?? tokens.ui.ink;
    parts.push(
      `<rect x="${lx}" y="36" width="14" height="4" rx="2" fill="${color}"/>`,
      `<text x="${lx + 18}" y="42" ${FONT} font-size="11" fill="${tokens.ui.ink2}">P${p + 1}</text>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>\n`;
}

writeFileSync(
  new URL('bot-match-soldiers.svg', OUT),
  chart('Солдаты в армиях у каждого игрока', 'soldiers', 'солдат'),
);
writeFileSync(
  new URL('bot-match-gold.svg', OUT),
  chart('Золото в казне у каждого игрока', 'gold', 'золото'),
);
const n = match.samples[0]?.players.length ?? 0;
const head = [
  't_s',
  ...Array.from({ length: n }, (_, p) => [
    `P${p + 1}_soldiers`,
    `P${p + 1}_units`,
    `P${p + 1}_gold`,
    `P${p + 1}_hexes`,
    `P${p + 1}_cities`,
    `P${p + 1}_alive`,
  ]).flat(),
];
const rows = match.samples.map((s) =>
  [
    s.t,
    ...s.players.flatMap((q) => [q.soldiers, q.units, q.gold, q.hexes, q.cities, q.alive ? 1 : 0]),
  ].join(','),
);
writeFileSync(new URL('bot-match.csv', OUT), [head.join(','), ...rows].join('\n') + '\n');
console.log('готово: bot-match-soldiers.svg, bot-match-gold.svg, bot-match.csv');
