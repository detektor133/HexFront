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
import { hashState } from '../src/state/hash.ts';
import { recomputeNetworks } from '../src/state/network.ts';
import { hexSupplyEff, recalculateSupply } from '../src/state/supply.ts';
import type { MatchState, Player } from '../src/state/types.ts';
import { rebuildUnitIndex } from '../src/state/unit-index.ts';
import { step, SYSTEMS } from '../src/step.ts';
import { economySystem } from '../src/systems/economy.ts';

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
  stableHexes: readonly number[],
): unknown {
  const networks = state.networks.filter((network) => network.owner === playerId);
  return {
    bankrupt: state.players[playerId]?.bankrupt,
    networks,
    networkHexes: stableHexes.map((hex) => [hex, state.hexes.network[hex]]),
    ratios: networks.map((network) => [network.id, state.supplyRatios.get(network.id) ?? -1]),
    units: state.units
      .filter((unit) => unit.owner === playerId)
      .map((unit) => [unit.id, unit.supplyLevel, unit.encircled]),
  };
}

function expectProcessedPlayersEquivalent(
  state: MatchState,
  reference: MatchState,
  tick: number,
): void {
  const stableHexesByPlayer = new Map<number, number[]>();
  for (let hex = 0; hex < state.hexes.owner.length; hex += 1) {
    const owner = state.hexes.owner[hex];
    if (owner !== undefined && owner === reference.hexes.owner[hex]) {
      const stableHexes = stableHexesByPlayer.get(owner) ?? [];
      stableHexes.push(hex);
      stableHexesByPlayer.set(owner, stableHexes);
    }
  }
  for (const player of processedPlayers(state, tick)) {
    const stableHexes = stableHexesByPlayer.get(player.id) ?? [];
    expect(
      playerSupplySnapshot(state, player.id, stableHexes),
      `тик ${tick}, игрок ${player.id}`,
    ).toEqual(playerSupplySnapshot(reference, player.id, stableHexes));
  }
}

function copyForSupplyRecalculation(state: MatchState, playerIds: ReadonlySet<number>): MatchState {
  const units = state.units.slice();
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (unit && playerIds.has(unit.owner)) units[index] = { ...unit };
  }
  return {
    ...state,
    hexes: { ...state.hexes, network: state.hexes.network.slice() },
    networks: state.networks.slice(),
    supplyRatios: new Map(),
    units,
  };
}

function manualTick(state: MatchState, commands: Parameters<typeof applyCommands>[1]): void {
  const tick = state.tick;
  state.events = [];
  applyCommands(state, commands);
  for (const system of SYSTEMS.slice(0, 5)) system(state);

  const players = processedPlayers(state, tick);
  const reference = copyForSupplyRecalculation(state, new Set(players.map((player) => player.id)));
  for (const player of players) {
    recomputeNetworks(reference, player.id, true);
    recalculateSupply(reference, player.id);
  }
  expectProcessedPlayersEquivalent(state, reference, tick);

  for (const system of SYSTEMS.slice(5)) {
    if (system === economySystem) economySystem(state);
    else system(state);
  }
  state.tick += 1;
}

function runAndCompare(state: MatchState, ticks: number): void {
  rebuildUnitIndex(state);
  for (const player of state.players) player.gold = 1_000_000_000 as Fp;
  for (let i = 0; i < ticks; i += 1) manualTick(state, warCommands(state));
}

describe('инкрементальные снабжение и сети', () => {
  it('сравнивает обработанных игроков с полным пересчётом после каждого тика войны', () => {
    const state = createMatch(generatedMap(42, 2), [{ name: 'A' }, { name: 'B' }], 42);
    rebuildUnitIndex(state);
    for (const player of state.players) player.gold = 1_000_000_000 as Fp;
    const stepped = cloneState(state);
    for (let tick = 0; tick < WAR_TICKS; tick += 1) {
      const commands = warCommands(state);
      manualTick(state, commands);
      if (tick < 100) {
        step(stepped, commands);
        expect(hashState(state)).toBe(hashState(stepped));
      }
    }
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

    manualTick(state, [{ playerId: 0, cmd: { t: 'build', hex: roadHex, kind: 'depot' } }]);
    while (state.constructions.length > 0) manualTick(state, []);
    manualTick(state, [{ playerId: 0, cmd: { t: 'build', hex: fortHex, kind: 'fort' } }]);
    while (state.constructions.length > 0) manualTick(state, []);
    manualTick(state, [{ playerId: 0, cmd: { t: 'foundCity', hex: 10 } }]);
    while (state.constructions.length > 0) manualTick(state, []);

    const capitalHex = state.cities.find(
      (city_) => city_.id === state.players[0]?.capitalCityId,
    )?.hex;
    if (capitalHex === undefined) throw new Error('тест: нет столицы A');
    captureHex(state, capitalHex, 1);
    expect(hexSupplyEff(state, 0, capitalHex)).toBeGreaterThanOrEqual(0);
    manualTick(state, []);

    const attacker = s.unit('A', 'infantry', 900, at(9, 1));
    const defender = s.unit('B', 'infantry', 100, at(10, 1));
    for (let tick = 0; tick < 300; tick += 1) {
      manualTick(
        state,
        tick === 0 ? [{ playerId: 0, cmd: { t: 'attack', unitIds: [attacker], target: 23 } }] : [],
      );
      if (state.units.find((unit) => unit.id === defender)?.order === 'retreat') break;
    }
  }, 120_000);
});
