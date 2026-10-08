// Отчёт матча одной командой: headless-прогоны ботов по сидам, метрики в JSON, графики PNG и CSV
// в docs/reports/match/seed-<сид>/, в консоль — сводка до 20 строк.
// Запуск: pnpm report:match --seeds N [--first-seed 42] [--players 6]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderTerritoryTimelapse, type TerritoryFrame } from './territory-timelapse.ts';

const root = new URL('../../../', import.meta.url);
const rootPath = fileURLToPath(root);

function option(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name}: нужно целое ≥ 1`);
  return value;
}

function textOption(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const seeds = option('seeds', 1);
const firstSeed = option('first-seed', 42);
const players = option('players', 6);
const map = textOption('map', 'small');
if (map !== 'small' && map !== 'gen') throw new Error('--map: ожидается small или gen');
const MAX_SUMMARY_LINES = 20;
const NODE = ['--disable-warning=DEP0190', '--experimental-strip-types'];

interface Match {
  readonly map: string;
  readonly winner: number;
  readonly endS: number;
  readonly wallS: number;
  readonly rejected: Readonly<Record<string, number>>;
  readonly acceptance?: {
    readonly maxGoldOver5000S: number;
    readonly maxUnitUnder10S: number;
    readonly centralNeutralAt10: number;
    readonly maxUnitSizeAt25?: number;
    readonly averageSoldiersPerUnitAt25?: number;
  };
  readonly samples: readonly {
    readonly players: readonly { soldiers: number; units: number; alive: boolean }[];
    readonly t: number;
  }[];
  readonly final: {
    readonly width: number;
    readonly height: number;
    readonly terrain: readonly number[];
  };
  readonly frames: readonly TerritoryFrame[];
}

function acceptanceLines(match: Match): string[] {
  const acceptance = match.acceptance;
  if (!acceptance) return ['  критерии T26d: метрики отсутствуют'];
  const at25 = match.samples.find((sample) => sample.t === 25 * 60);
  const aggregateMax = Math.max(0, ...(at25?.players.map((player) => player.soldiers) ?? []));
  const aggregateAverage = at25
    ? at25.players.reduce((sum, player) => sum + player.soldiers, 0) /
      at25.players.reduce((sum, player) => sum + player.units, 0)
    : null;
  return [
    `  золото > 5 000: ${acceptance.maxGoldOver5000S.toFixed(1)} с`,
    `  отряд < 10 солдат: ${acceptance.maxUnitUnder10S.toFixed(1)} с`,
    `  ничьи проходимые гексы в центре на 10:00: ${(acceptance.centralNeutralAt10 * 100).toFixed(1)} %`,
    `  на 25:00: макс. размер ${acceptance.maxUnitSizeAt25 ?? aggregateMax} солдат, ` +
      `среднее ${acceptance.averageSoldiersPerUnitAt25?.toFixed(1) ?? aggregateAverage?.toFixed(1) ?? 'нет данных'} солдат/отряд`,
  ];
}

function runMatch(seed: number, outDir: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        ...NODE,
        'tools/replay/src/bot-match.ts',
        String(players),
        String(seed),
        `${outDir}/metrics.json`,
        map,
      ],
      { cwd: rootPath, stdio: 'ignore' },
    );
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const dirs = Array.from({ length: seeds }, (_, i) => {
  const seed = firstSeed + i;
  const dir = `docs/reports/match/seed-${seed}`;
  mkdirSync(`${rootPath}${dir}`, { recursive: true });
  return { seed, dir };
});

const codes = await Promise.all(dirs.map((d) => runMatch(d.seed, d.dir)));
const summary: string[] = [`report:match — ${seeds} матч(ей), ${players} ботов, карта ${map}`];
const charted: string[] = [];

dirs.forEach(({ seed, dir }, i) => {
  if (codes[i] !== 0) {
    summary.push(`сид ${seed}: прогон упал (код ${codes[i]})`);
    return;
  }
  const chart = spawnSync(
    process.execPath,
    [...NODE, 'tools/replay/src/bot-match-chart.ts', `${dir}/metrics.json`, dir],
    { cwd: rootPath, encoding: 'utf8' },
  );
  if (chart.status !== 0) summary.push(`сид ${seed}: графики не построены`);
  else charted.push(`${rootPath}${dir}`);
  const m = JSON.parse(readFileSync(`${rootPath}${dir}/metrics.json`, 'utf8')) as Match;
  if (map === 'gen') {
    const tokens = JSON.parse(
      readFileSync(new URL('../../../docs/art/tokens.json', import.meta.url), 'utf8'),
    ) as {
      map: { background: string; terrain: Record<string, string> };
      players: { palette: { line: string }[] };
    };
    const png = renderTerritoryTimelapse(m.final.width, m.final.height, m.final.terrain, m.frames, {
      background: tokens.map.background,
      terrain: [
        tokens.map.background,
        tokens.map.terrain.plains ?? tokens.map.background,
        tokens.map.terrain.forest ?? tokens.map.background,
        tokens.map.terrain.hills ?? tokens.map.background,
        tokens.map.terrain.mountains ?? tokens.map.background,
        tokens.map.terrain.desert ?? tokens.map.background,
      ],
      players: tokens.players.palette.map((player) => player.line),
    });
    writeFileSync(`${rootPath}${dir}/territory-timelapse.png`, png);
  }
  const last = m.samples.at(-1)?.players ?? [];
  const alive = last.filter((p) => p.alive).length;
  const topReject = Object.entries(m.rejected)[0];
  const mm = String(Math.floor(m.endS / 60)).padStart(2, '0');
  const ss = String(Math.round(m.endS % 60)).padStart(2, '0');
  summary.push(
    `сид ${seed}: победил P${m.winner + 1}, ${mm}:${ss}, живых ${alive}/${last.length}, ` +
      `солдат ${last.reduce((s, p) => s + p.soldiers, 0)}, отказов ${
        topReject ? `${topReject[0]} ×${topReject[1]}` : 'нет'
      }, прогон ${Math.round(m.wallS)} с`,
  );
  summary.push(...acceptanceLines(m));
});

if (charted.length > 0) {
  const png = spawnSync(
    process.execPath,
    [...NODE, 'apps/client/scripts/svg-to-png.ts', ...charted],
    { cwd: rootPath, encoding: 'utf8' },
  );
  if (png.status !== 0) summary.push('PNG графиков не построены (svg-to-png упал)');
}
summary.push(
  'метрики и графики: docs/reports/match/seed-<сид>/ (metrics.json, *.png, bot-match.csv)',
);
console.log(summary.slice(0, MAX_SUMMARY_LINES).join('\n'));
process.exit(codes.some((c) => c !== 0) ? 1 : 0);
