import { describe, expect, it } from 'vitest';

import { assignFront, assignUnits, at, city, createArmy, own, scenario } from './scenario/dsl.ts';
import small from '../../mapgen/maps/small.json' with { type: 'json' };
import { createBotTickContext } from '../src/bots/context.ts';
import { COMMAND_OPTIONS, type BotOptionDefinitions } from '../src/bots/options/index.ts';
import { createMatch, loadMap } from '../src/index.ts';
import { fp, fpDiv, type Fp } from '../src/math/int.ts';
import { cityGold } from '../src/state/city-output.ts';
import { cityPopCap, hexPopCap } from '../src/state/pop-cap.ts';
import type { MatchState } from '../src/state/types.ts';
import { incomePerSecond, playerIncomePerSecond } from '../src/systems/economy.ts';

function fixture(): { state: MatchState; context: ReturnType<typeof createBotTickContext> } {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const state = createMatch(loaded.map, [{ name: 'A' }, { name: 'B' }], 42);
  const player = state.players[0];
  if (!player) throw new Error('игрок не создан');
  player.gold = fp(1000);
  return { state, context: createBotTickContext(state) };
}

const definitions: BotOptionDefinitions = {
  units: {
    scouts: {
      costGoldPerSoldier: fp(0.2),
      upkeepGoldPerSoldierS: fp(0.004),
      upkeepGoldPerUnitS: fp(0.05),
      attack: fp(3),
      defense: fp(2),
      supplyPerSoldier: fp(0.5),
    },
  },
  buildings: {
    watchtower: {
      costGold: fp(90),
      defenseMult: fp(1.1),
      supplyLossMult: fp(0.9),
      supplyRadius: 2,
    },
  },
};

const scenarioLegend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 1),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const scenarioField = `
  a a a a a a a a a a a a a a a a
  a A1 a a a a a a a a a a a A2 a a
  a a a a a a a a a a a a a a a a
  b b b b b b b B1 b b b b b b b b
`;

describe('варианты команд бота', () => {
  it('регистрирует все виды команд отдельными генераторами', () => {
    expect(COMMAND_OPTIONS.map((entry) => entry.kind)).toEqual([
      'recruit',
      'build',
      'upgradeCity',
      'improve',
      'foundCity',
      'rebuildSupply',
      'setTax',
      'startOffensive',
      'stopOffensive',
    ]);
  });

  it('подхватывает фиктивные тип войск и постройку из definitions', () => {
    const { state, context } = fixture();
    const options = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    );

    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: expect.objectContaining({ type: 'scouts' }) }),
        expect.objectContaining({ command: expect.objectContaining({ kind: 'watchtower' }) }),
      ]),
    );
  });

  it('возвращает эффекты fixed-point, а не пустой каталог', () => {
    const { state, context } = fixture();
    const options = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    );

    expect(options.length).toBeGreaterThan(0);
    expect(
      options.some((option) => Object.values(option.effects).some((value) => value !== 0)),
    ).toBe(true);
  });

  it('нормализует цену относительно текущей казны игрока', () => {
    const { state, context } = fixture();
    const recruit = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    ).find((candidate) => candidate.command.t === 'recruit');

    expect(recruit?.effects.cost).toBe(fp(0.01));
  });

  it('считает доход улучшения города как прирост выработки', () => {
    const { state, context } = fixture();
    const city = context.citiesByPlayer[0]?.[0];
    if (!city) throw new Error('город не создан');
    city.level = 1;
    state.constructions.length = 0;
    const option = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    ).find(
      (candidate) => candidate.command.t === 'upgradeCity' && candidate.command.cityId === city.id,
    );
    const player = state.players[0];
    if (!option || !player) throw new Error('вариант улучшения не создан');
    const raw = (cityGold(state, { ...city, level: city.level + 1 }) -
      cityGold(state, city) +
      incomePerSecond(
        cityPopCap(city.level + 1) - cityPopCap(city.level),
        player.taxTarget,
        0,
      )) as Fp;

    expect(option.effects.income).toBe(
      fpDiv(raw, playerIncomePerSecond(state, 0, undefined, context.incomeBases) as Fp),
    );
  });

  it('считает доход улучшения гекса как прирост лимита', () => {
    const { state, context } = fixture();
    const hex = context.ownedHexes[0]?.find(
      (value) => !state.cities.some((city) => city.hex === value),
    );
    if (hex === undefined) throw new Error('свободный гекс не найден');
    const option = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    ).find((candidate) => candidate.command.t === 'improve' && candidate.command.hex === hex);
    const player = state.players[0];
    if (!option || !player) throw new Error('вариант улучшения гекса не создан');
    const improvement = new Uint8Array(state.hexes.improvement);
    improvement[hex] = (improvement[hex] ?? 0) + 1;
    const nextCap = hexPopCap({ map: state.map, hexes: { improvement } }, hex);
    const raw = incomePerSecond((nextCap - hexPopCap(state, hex)) as Fp, player.taxTarget, 0) as Fp;

    expect(option.effects.income).toBe(
      fpDiv(raw, playerIncomePerSecond(state, 0, undefined, context.incomeBases) as Fp),
    );
  });

  it('создаёт ненулевой эффект для каждого вида команды на игровом сценарии', () => {
    const match = scenario(scenarioField, { legend: scenarioLegend, fog: false });
    match.player('A').gold = fp(5000);
    match.state.hexes.owner.forEach((owner, hex) => {
      if (owner === 0) match.state.hexes.pop[hex] = hexPopCap(match.state, hex);
    });
    const unitIds = [0, 1, 2].map(() => match.unit('A', 'infantry', 300, at(2, 2)));
    match.cmd('A', createArmy(''));
    match.runTicks(1);
    const armyId = match.armiesOf('A')[0]?.id ?? -1;
    match.cmd('A', assignUnits(unitIds, armyId), 'auto');
    match.cmd('A', assignFront(armyId, 'B', null), 'auto');
    match.runSeconds(20);

    const start = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(match.state, 0, createBotTickContext(match.state), definitions),
    );
    const plan = match.state.plans.find((value) => value.armyId === armyId);
    if (!plan || plan.kind !== 'front') throw new Error('фронт армии не создан');
    match.state.plans[match.state.plans.indexOf(plan)] = {
      ...plan,
      offensive: { edges: plan.edges, hexes: [], active: true, progressTick: 0, taken: [] },
    };
    const stop = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(match.state, 0, createBotTickContext(match.state), definitions),
    );
    const options = [...start, ...stop];
    const kinds = [
      'recruit',
      'build',
      'upgradeCity',
      'improve',
      'foundCity',
      'rebuildSupply',
      'setTax',
      'startOffensive',
      'stopOffensive',
    ];

    for (const kind of kinds) {
      const candidate = options.find((option) => option.command.t === kind);
      expect(candidate, `нет варианта ${kind}`).toBeDefined();
      expect(
        Object.values(candidate?.effects ?? {}).some((value) => value !== 0),
        kind,
      ).toBe(true);
    }
  });

  it('отбрасывает варианты для неполного состояния', () => {
    const state = {
      map: {},
      hexes: {},
      players: [],
      cities: [],
      recruits: [],
    } as unknown as MatchState;
    const context = {} as never;
    const options = COMMAND_OPTIONS.flatMap((entry) =>
      entry.options(state, 0, context, definitions),
    );

    expect(options).toEqual([]);
  });
});
