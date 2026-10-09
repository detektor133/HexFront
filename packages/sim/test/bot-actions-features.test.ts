import { describe, expect, it } from 'vitest';

import { BUILDING_DEFS, type UnitType } from '../src/balance.ts';
import { createActionCatalog, type ActionCatalogInput } from '../src/bots/actions.ts';
import { rankActions, scoreAction, type BotWeights } from '../src/bots/brain.ts';
import { actionFeatures } from '../src/bots/features.ts';
import { fp } from '../src/math/int.ts';

const input = (overrides: Partial<ActionCatalogInput> = {}): ActionCatalogInput => ({
  units: {
    infantry: {
      costGoldPerSoldier: fp(0.1),
      upkeepGoldPerSoldierS: fp(0.003),
      attack: fp(1),
      defense: fp(1.2),
      supplyPerSoldier: fp(1),
    },
  },
  buildings: BUILDING_DEFS,
  cityIds: [3],
  borderHexes: [8],
  cityHexes: [3],
  improveHexes: [8],
  foundHexes: [12],
  supplyCityIds: [3],
  taxRates: [fp(0), fp(0.2)],
  armies: [{ id: 4, hasEnemyFront: true, offensive: false }],
  recruitSoldiers: fp(50),
  ...overrides,
});

describe('каталог действий бота', () => {
  it('добавляет новый тип войск и постройку из переданных определений', () => {
    const catalog = createActionCatalog(
      input({
        units: {
          ...input().units,
          scouts: {
            costGoldPerSoldier: fp(0.2),
            upkeepGoldPerSoldierS: fp(0.004),
            attack: fp(0.8),
            defense: fp(0.7),
            supplyPerSoldier: fp(0.6),
          },
        },
        buildings: {
          ...BUILDING_DEFS,
          watchtower: { costGold: fp(90), defenseMult: fp(1.1), supplyLossMult: fp(0.9) },
        },
      }),
    );

    expect(catalog).toContainEqual(
      expect.objectContaining({ kind: 'recruit', unitType: 'scouts' }),
    );
    expect(catalog).toContainEqual(
      expect.objectContaining({ kind: 'build', buildingType: 'watchtower' }),
    );
  });

  it('сохраняет порядок каталога при одинаковых целях', () => {
    const catalog = createActionCatalog(input({ taxRates: [fp(0.2), fp(0)] }));

    expect(catalog.map((action) => action.order)).toEqual(
      catalog.map((action) => action.order).sort((a, b) => a - b),
    );
  });
});

describe('признаки действий бота', () => {
  it('считает эффекты и произведения с контекстами в fixed-point', () => {
    const action = createActionCatalog(input()).find(
      (candidate) =>
        candidate.kind === 'recruit' && candidate.unitType === ('infantry' as UnitType),
    );
    expect(action).toBeDefined();

    if (!action) throw new Error('действие набора не создано');

    const features = actionFeatures(action, {
      gold: fp(100),
      incomePerS: fp(2),
      upkeepPerS: fp(1),
      strength: fp(100),
      threat: fp(0.25),
      goldReserve: fp(0.5),
      neutralBorderShare: fp(0.4),
      ownSoldiers: fp(50),
      enemySoldiers: fp(50),
      enemyCities: 1,
    });

    expect(features.effectGold).toBe(fp(-0.05));
    expect(features.effectUpkeep).toBe(fp(-0.15));
    expect(features.effectStrength).toBe(fp(1.1));
    expect(features.threat).toBe(fp(0.25));
    expect(features.effectStrengthThreat).toBe(fp(0.275));
  });

  it('считает сумму весов и признаков в fixed-point', () => {
    const action = createActionCatalog(input()).find((candidate) => candidate.kind === 'recruit');
    expect(action).toBeDefined();
    if (!action) throw new Error('действие набора не создано');

    const context = {
      gold: fp(100),
      incomePerS: fp(2),
      upkeepPerS: fp(1),
      strength: fp(100),
      threat: fp(0.25),
      goldReserve: fp(0.5),
      neutralBorderShare: fp(0.4),
      ownSoldiers: fp(50),
      enemySoldiers: fp(50),
      enemyCities: 1,
    };
    const weights: BotWeights = { effectGold: 2, effectStrength: 3 };

    expect(scoreAction(action, context, weights)).toBe(2 * fp(-0.05) + 3 * fp(1.1));
  });

  it('меняет выбранное действие при изменении веса и сохраняет порядок равных оценок', () => {
    const catalog = createActionCatalog(
      input({
        cityIds: [3, 4],
        units: {
          ...input().units,
          scouts: {
            costGoldPerSoldier: fp(0.2),
            upkeepGoldPerSoldierS: fp(0.003),
            attack: fp(0.5),
            defense: fp(0.5),
            supplyPerSoldier: fp(1),
          },
        },
      }),
    ).filter((action) => action.kind === 'recruit');
    const context = {
      gold: fp(100),
      incomePerS: fp(2),
      upkeepPerS: fp(1),
      strength: fp(100),
      threat: fp(0.25),
      goldReserve: fp(0.5),
      neutralBorderShare: fp(0.4),
      ownSoldiers: fp(50),
      enemySoldiers: fp(50),
      enemyCities: 1,
    };

    expect(rankActions(catalog, context, { effectGold: -1 })[0]?.unitType).toBe('scouts');
    expect(rankActions(catalog, context, { effectStrength: 1 })[0]?.unitType).toBe('infantry');
    expect(rankActions(catalog, context, { effectGold: -1 })[0]?.order).toBe(1);
  });
});
