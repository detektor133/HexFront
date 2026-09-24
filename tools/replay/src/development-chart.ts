// График «10 минут развития без войны» (golden-реплей этапа 02) для отчёта:
// население и золото игрока 0 по времени. Запуск: pnpm --filter @hexfront/replay chart
import { readFileSync, writeFileSync } from 'node:fs';

import { createMatch, loadMap, step, TICKS_PER_S } from '../../../packages/sim/src/index.ts';
import {
  DEVELOPMENT_TICKS,
  developmentCommands,
} from '../../../packages/sim/test/golden/development-script.ts';

const root = new URL('../../../', import.meta.url);
const tokens = JSON.parse(readFileSync(new URL('docs/art/tokens.json', root), 'utf8')) as {
  ui: { ink: string; ink2: string; border: string; surface: string };
  players: { palette: { line: string }[] };
};
const SAMPLE_EVERY_S = 10;
const W = 720;
const H = 300;
const PAD = 48;

interface Sample {
  readonly t: number;
  readonly pop: number;
  readonly gold: number;
}

function simulate(): Sample[] {
  const map = loadMap(
    JSON.parse(readFileSync(new URL('packages/mapgen/maps/small.json', root), 'utf8')),
  );
  if (!map.ok) throw new Error(map.errors.join('\n'));
  const state = createMatch(map.map, [{ name: 'A' }, { name: 'B' }], 42);
  const samples: Sample[] = [];
  for (let i = 0; i <= DEVELOPMENT_TICKS; i += 1) {
    if (state.tick % (SAMPLE_EVERY_S * TICKS_PER_S) === 0) {
      let pop = 0;
      state.hexes.owner.forEach((o, id) => {
        if (o === 0) pop += state.hexes.pop[id] ?? 0;
      });
      samples.push({
        t: state.tick / TICKS_PER_S,
        pop: pop / 1000,
        gold: (state.players[0]?.gold ?? 0) / 1000,
      });
    }
    if (i < DEVELOPMENT_TICKS) step(state, developmentCommands(state));
  }
  return samples;
}

function polyline(samples: Sample[], key: 'pop' | 'gold', max: number): string {
  const maxT = samples.at(-1)?.t ?? 1;
  return samples
    .map((s) => {
      const x = PAD + ((W - 2 * PAD) * s.t) / maxT;
      const y = H - PAD - ((H - 2 * PAD) * s[key]) / max;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function svg(samples: Sample[]): string {
  const max = Math.ceil(Math.max(...samples.flatMap((s) => [s.pop, s.gold])) / 100) * 100;
  const popColor = tokens.players.palette[0]?.line ?? tokens.ui.ink;
  const goldColor = tokens.players.palette[3]?.line ?? tokens.ui.ink2;
  const last = samples.at(-1);
  const ticks = [0, 120, 240, 360, 480, 600]
    .map((t) => {
      const x = PAD + ((W - 2 * PAD) * t) / 600;
      return `<text x="${x}" y="${H - PAD + 18}" text-anchor="middle">${t / 60} мин</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Golos Text, sans-serif" font-size="12" fill="${tokens.ui.ink2}">
<rect width="${W}" height="${H}" fill="${tokens.ui.surface}"/>
<line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="${tokens.ui.border}"/>
<line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="${tokens.ui.border}"/>
<text x="${PAD - 6}" y="${PAD + 4}" text-anchor="end">${max}</text>
<text x="${PAD - 6}" y="${H - PAD + 4}" text-anchor="end">0</text>
${ticks}
<polyline fill="none" stroke="${popColor}" stroke-width="2.5" points="${polyline(samples, 'pop', max)}"/>
<polyline fill="none" stroke="${goldColor}" stroke-width="2.5" points="${polyline(samples, 'gold', max)}"/>
<text x="${W - PAD}" y="${PAD - 16}" text-anchor="end" fill="${popColor}">население: ${last?.pop.toFixed(0)} чел.</text>
<text x="${W - PAD}" y="${PAD - 2}" text-anchor="end" fill="${goldColor}">золото: ${last?.gold.toFixed(0)}</text>
</svg>
`;
}

const samples = simulate();
writeFileSync(new URL('docs/reports/stage-02/development.svg', root), svg(samples));
const csv = [
  't_s,pop,gold',
  ...samples.map((s) => `${s.t},${s.pop.toFixed(1)},${s.gold.toFixed(1)}`),
];
writeFileSync(new URL('docs/reports/stage-02/development.csv', root), `${csv.join('\n')}\n`);
console.log(
  `samples: ${samples.length}; last: pop ${samples.at(-1)?.pop.toFixed(1)}, gold ${samples.at(-1)?.gold.toFixed(1)}`,
);
