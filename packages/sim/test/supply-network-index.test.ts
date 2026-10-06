import { describe, expect, it } from 'vitest';

import { warCommands, WAR_TICKS } from './golden/war-script.ts';
import { cloneState } from './invariants/clone.ts';
import { generateMap } from '../../mapgen/src/index.ts';
import { NETWORK_RECALC_TICKS } from '../src/balance.ts';
import { at, city, own, road, scenario } from './scenario/dsl.ts';
import { applyCommands } from '../src/commands/apply.ts';
import { loadMap } from '../src/map/load.ts';
import type { Fp } from '../src/math/int.ts';
import { captureHex } from '../src/state/capture.ts';
import { createMatch } from '../src/state/create-match.ts';
import { recomputeAllNetworks } from '../src/state/network.ts';
import { hexSupplyEff, recalculateSupply } from '../src/state/supply.ts';
import type { MatchState, Player } from '../src/state/types.ts';
import { rebuildUnitIndex } from '../src/state/unit-index.ts';
import { step, SYSTEMS } from '../src/step.ts';

function generatedMap(seed: number, players: number) {
  const loaded = loadMap(generateMap(seed, { players }));
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  return loaded.map;
}

function processedPlayers(state: MatchState, tick: number): readonly Player[] {
  const phase = tick % NETWORK_RECALC_TICKS;
  return state.players.filter(
    (player) => player.status === 'alive' && player.id % NETWORK_RECALC_TICKS === phase,
  );
}

function playerSupplySnapshot(
  state: MatchState,
  playerId: number,
  stableHexes: ReadonlySet<number>,
  unitIds: ReadonlySet<number>,
): unknown {
  return {
    bankrupt: state.players[playerId]?.bankrupt,
    networks: state.networks.filter((network) => network.owner === playerId),
    networkHexes: Array.from(stableHexes, (hex) => [hex, state.hexes.network[hex]]),
    ratios: state.networks
      .filter((network) => network.owner === playerId)
      .map((network) => [network.id, state.supplyRatios.get(network.id) ?? -1]),
    units: state.units
      .filter((unit) => unit.owner === playerId && unitIds.has(unit.id))
      .map((unit) => [unit.id, unit.supplyLevel, unit.encircled]),
  };
}

function expectProcessedPlayersEquivalent(
  state: MatchState,
  reference: MatchState,
  tick: number,
): void {
  recomputeAllNetworks(reference);
  for (const player of reference.players) recalculateSupply(reference, player.id);
  const unitIds = new Set(
    state.units
      .map((unit) => unit.id)
      .filter((id) => reference.units.some((unit) => unit.id === id)),
  );
  for (const player of processedPlayers(state, tick)) {
    const stableHexes = new Set<number>();
    for (let hex = 0; hex < state.hexes.owner.length; hex += 1) {
      if (state.hexes.owner[hex] === player.id && reference.hexes.owner[hex] === player.id) {
        stableHexes.add(hex);
      }
    }
    expect(
      playerSupplySnapshot(state, player.id, stableHexes, unitIds),
      `тик ${tick}, игрок ${player.id}`,
    ).toEqual(playerSupplySnapshot(reference, player.id, stableHexes, unitIds));
  }
}

function runAndCompare(state: MatchState, ticks: number): void {
  rebuildUnitIndex(state);
  for (const player of state.players) player.gold = 1_000_000_000 as Fp;
  for (let i = 0; i < ticks; i += 1) {
    const tick = state.tick;
    const commands = warCommands(state);
    const reference = cloneState(state);
    step(state, commands);
    applyCommands(reference, commands);
    for (const system of SYSTEMS.slice(0, 5)) system(reference);
    expectProcessedPlayersEquivalent(state, reference, tick);
  }
}

function stepAndCompare(state: MatchState, commands: Parameters<typeof applyCommands>[1]): void {
  const tick = state.tick;
  const reference = cloneState(state);
  step(state, commands);
  applyCommands(reference, commands);
  for (const system of SYSTEMS.slice(0, 5)) system(reference);
  expectProcessedPlayersEquivalent(state, reference, tick);
}

describe('инкрементальные снабжение и сети', () => {
  it('сравнивает обработанных игроков с полным клоном после каждого тика войны', () => {
    const state = createMatch(generatedMap(42, 2), [{ name: 'A' }, { name: 'B' }], 42);
    runAndCompare(state, WAR_TICKS);
  }, 120_000);

  it('совпадает с полным пересчётом на gen-карте для 30 игроков за 1000 тиков', () => {
    const state = createMatch(
      generatedMap(43, 30),
      Array.from({ length: 30 }, (_, id) => ({ name: `P${id}` })),
      43,
      { fog: false },
    );
    runAndCompare(state, 1000);
  }, 120_000);

  it('сохраняет эквивалентность при постройках, городе, столице и отступлении', () => {
    const s = scenario(
      `
      a  A1 r  r  r  r  A2 a  a  a  a  b  B1
      a  a  a  a  a  a  a  a  a  a  b  b  b
      a  a  a  a  a  a  a  a  a  a  b  b  b
      `,
      {
        legend: {
          A1: city('A', 1, { capital: true }),
          A2: city('A', 1),
          B1: city('B', 1, { capital: true }),
          a: own('A'),
          b: own('B'),
          r: road('A'),
        },
      },
    );
    const state = s.state;
    for (const player of state.players) player.gold = 1_000_000_000 as Fp;
    rebuildUnitIndex(state);
    const roadHex = 2;
    const fortHex = 8;
    s.setPop(at(10, 0), 60);

    stepAndCompare(state, [{ playerId: 0, cmd: { t: 'build', hex: roadHex, kind: 'depot' } }]);
    while (state.constructions.length > 0) stepAndCompare(state, []);
    stepAndCompare(state, [{ playerId: 0, cmd: { t: 'build', hex: fortHex, kind: 'fort' } }]);
    while (state.constructions.length > 0) stepAndCompare(state, []);
    stepAndCompare(state, [{ playerId: 0, cmd: { t: 'foundCity', hex: 10 } }]);
    while (state.constructions.length > 0) stepAndCompare(state, []);

    const capitalHex = state.cities.find(
      (city_) => city_.id === state.players[0]?.capitalCityId,
    )?.hex;
    if (capitalHex === undefined) throw new Error('тест: нет столицы A');
    captureHex(state, capitalHex, 1);
    expect(hexSupplyEff(state, 0, capitalHex)).toBeGreaterThanOrEqual(0);
    stepAndCompare(state, []);

    const attacker = s.unit('A', 'infantry', 900, at(9, 1));
    const defender = s.unit('B', 'infantry', 100, at(10, 1));
    for (let tick = 0; tick < 300; tick += 1) {
      stepAndCompare(
        state,
        tick === 0 ? [{ playerId: 0, cmd: { t: 'attack', unitIds: [attacker], target: 23 } }] : [],
      );
      if (state.units.find((unit) => unit.id === defender)?.order === 'retreat') break;
    }
  }, 120_000);
});
