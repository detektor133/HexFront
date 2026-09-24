// Доход игроков: налог с населения, города, шахты; изолированные сети — ×0,5.
// GDD: docs/gdd/02-economy.md — «Золото»; 04-roads-supply.md — «Сети снабжения».
import {
  CITY_GOLD_PER_LEVEL,
  GOLD_PER_POP_TAX,
  ISOLATED_INCOME_MULT,
  MINE_GOLD_PER_S,
  TICKS_PER_S,
} from '../balance.ts';
import { FEATURE } from '../map/types.ts';
import { hexFromId, hexId, inBounds, spiral } from '../math/hex.ts';
import { fpMul, intDiv, type Fp } from '../math/int.ts';
import { isCityIsolated } from '../state/network.ts';
import { NEUTRAL, type MatchState } from '../state/types.ts';

/** Радиус, в котором гекс относится к городу (тот же, что у роста населения). */
const COVERAGE_RADIUS = 2;

// Налог гекса ×0,5, только если все свои города в радиусе 2 от него изолированы; хоть один
// город основной сети рядом — налог полный. Вне радиуса городов — без штрафа (02-economy.md, «Золото»).
function isolatedHexes(state: MatchState): Uint8Array {
  const { width, height } = state.map;
  const covered = new Uint8Array(width * height);
  const connected = new Uint8Array(width * height);
  for (const c of state.cities) {
    if (c.owner === NEUTRAL) continue;
    const isMain = !isCityIsolated(state, c.id);
    for (const h of spiral(hexFromId(c.hex, width), COVERAGE_RADIUS)) {
      if (!inBounds(h, width, height)) continue;
      const id = hexId(h, width);
      if (state.hexes.owner[id] !== c.owner) continue;
      covered[id] = 1;
      if (isMain) connected[id] = 1;
    }
  }
  return covered.map((cov, id) => (cov === 1 && connected[id] === 0 ? 1 : 0));
}

interface Base {
  pop: number;
  isolatedPop: number;
  mines: number;
  isolatedMines: number;
  cityLevels: number;
  isolatedCityLevels: number;
}

function incomeBases(state: MatchState): Base[] {
  const bases: Base[] = state.players.map(() => ({
    pop: 0,
    isolatedPop: 0,
    mines: 0,
    isolatedMines: 0,
    cityLevels: 0,
    isolatedCityLevels: 0,
  }));
  const cut = isolatedHexes(state);
  const { owner, pop } = state.hexes;
  for (let id = 0; id < owner.length; id += 1) {
    const base = bases[owner[id] ?? NEUTRAL];
    if (!base) continue;
    const isolated = cut[id] === 1;
    if (isolated) base.isolatedPop += pop[id] ?? 0;
    else base.pop += pop[id] ?? 0;
    if (state.map.features[id] !== FEATURE.mine) continue;
    if (isolated) base.isolatedMines += 1;
    else base.mines += 1;
  }
  for (const c of state.cities) {
    const base = bases[c.owner];
    if (!base) continue;
    if (isCityIsolated(state, c.id)) base.isolatedCityLevels += c.level;
    else base.cityLevels += c.level;
  }
  return bases;
}

function incomePerSecond(pop: number, tax: Fp, cityLevels: number, mines: number): number {
  return (
    fpMul(fpMul(pop as Fp, tax), GOLD_PER_POP_TAX) +
    CITY_GOLD_PER_LEVEL * cityLevels +
    MINE_GOLD_PER_S * mines
  );
}

/**
 * Начисляет доход за тик:
 * income/с = Σpop × taxEffective × GOLD_PER_POP_TAX + Σ CITY_GOLD_PER_LEVEL × level + Σ MINE_GOLD_PER_S,
 * для гексов и городов изолированных сетей — × ISOLATED_INCOME_MULT.
 * Расходы (содержание армий) и банкротство — этап 03.
 */
export function economySystem(state: MatchState): void {
  const bases = incomeBases(state);
  state.players.forEach((p, i) => {
    const b = bases[i];
    if (p.status !== 'alive' || !b) return;
    const connected = incomePerSecond(b.pop, p.taxEffective, b.cityLevels, b.mines);
    const isolated = incomePerSecond(
      b.isolatedPop,
      p.taxEffective,
      b.isolatedCityLevels,
      b.isolatedMines,
    );
    const perSecond = connected + fpMul(isolated as Fp, ISOLATED_INCOME_MULT);
    p.gold = (p.gold + intDiv(perSecond, TICKS_PER_S)) as Fp;
  });
}
