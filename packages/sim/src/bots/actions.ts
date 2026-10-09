import { fpMul, type Fp } from '../math/int.ts';

export interface UnitActionDefinition {
  readonly costGoldPerSoldier: Fp;
  readonly upkeepGoldPerSoldierS: Fp;
  readonly attack: Fp;
  readonly defense: Fp;
  readonly supplyPerSoldier: Fp;
}

export interface BuildingActionDefinition {
  readonly costGold: Fp;
  readonly defenseMult: Fp;
  readonly supplyLossMult: Fp;
}

export type ActionKind =
  | 'recruit'
  | 'build'
  | 'upgradeCity'
  | 'improve'
  | 'foundCity'
  | 'rebuildSupply'
  | 'setTax'
  | 'startOffensive'
  | 'stopOffensive';

export interface BotAction {
  readonly kind: ActionKind;
  readonly order: number;
  readonly targetId: number;
  readonly unitType?: string;
  readonly buildingType?: string;
  readonly rate?: Fp;
  readonly costGold: Fp;
  readonly upkeepGoldPerS: Fp;
  readonly incomeGoldPerS: Fp;
  readonly strength: Fp;
  readonly defense: Fp;
  readonly supply: Fp;
}

export interface ActionCatalogInput {
  readonly units: Readonly<Record<string, UnitActionDefinition>>;
  readonly buildings: Readonly<Record<string, BuildingActionDefinition>>;
  readonly cityIds: readonly number[];
  readonly borderHexes: readonly number[];
  readonly cityHexes: readonly number[];
  readonly improveHexes: readonly number[];
  readonly foundHexes: readonly number[];
  readonly supplyCityIds: readonly number[];
  readonly taxRates: readonly Fp[];
  readonly armies: readonly {
    readonly id: number;
    readonly hasEnemyFront: boolean;
    readonly offensive: boolean;
  }[];
  readonly recruitSoldiers: Fp;
}

function sortedUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function addRecruitActions(input: ActionCatalogInput, actions: BotAction[], order: number): number {
  const cities = sortedUnique(input.cityIds);
  for (const cityId of cities) {
    for (const [unitType, definition] of Object.entries(input.units)) {
      const soldiers = input.recruitSoldiers;
      actions.push({
        kind: 'recruit',
        order: order++,
        targetId: cityId,
        unitType,
        costGold: fpMul(definition.costGoldPerSoldier, soldiers),
        upkeepGoldPerS: fpMul(definition.upkeepGoldPerSoldierS, soldiers),
        incomeGoldPerS: 0 as Fp,
        strength: fpMul(soldiers, (definition.attack + definition.defense) as Fp),
        defense: 0 as Fp,
        supply: fpMul(definition.supplyPerSoldier, soldiers),
      });
    }
  }
  return order;
}

function addBuildActions(input: ActionCatalogInput, actions: BotAction[], order: number): number {
  const hexes = sortedUnique([...input.borderHexes, ...input.cityHexes]);
  for (const hex of hexes) {
    for (const [buildingType, definition] of Object.entries(input.buildings)) {
      actions.push({
        kind: 'build',
        order: order++,
        targetId: hex,
        buildingType,
        costGold: definition.costGold,
        upkeepGoldPerS: 0 as Fp,
        incomeGoldPerS: 0 as Fp,
        strength: 0 as Fp,
        defense: definition.defenseMult,
        supply: definition.supplyLossMult,
      });
    }
  }
  return order;
}

/**
 * Строит каталог действий из переданных определений и доступных целей.
 * @returns действия в стабильном порядке каталога
 */
export function createActionCatalog(input: ActionCatalogInput): readonly BotAction[] {
  const actions: BotAction[] = [];
  let order = 0;
  order = addRecruitActions(input, actions, order);
  order = addBuildActions(input, actions, order);
  for (const cityId of sortedUnique(input.cityIds)) {
    actions.push({
      kind: 'upgradeCity',
      order: order++,
      targetId: cityId,
      costGold: 0 as Fp,
      upkeepGoldPerS: 0 as Fp,
      incomeGoldPerS: 0 as Fp,
      strength: 0 as Fp,
      defense: 0 as Fp,
      supply: 0 as Fp,
    });
  }
  for (const hex of sortedUnique(input.improveHexes)) {
    actions.push({
      kind: 'improve',
      order: order++,
      targetId: hex,
      costGold: 0 as Fp,
      upkeepGoldPerS: 0 as Fp,
      incomeGoldPerS: 0 as Fp,
      strength: 0 as Fp,
      defense: 0 as Fp,
      supply: 0 as Fp,
    });
  }
  for (const hex of sortedUnique(input.foundHexes)) {
    actions.push({
      kind: 'foundCity',
      order: order++,
      targetId: hex,
      costGold: 0 as Fp,
      upkeepGoldPerS: 0 as Fp,
      incomeGoldPerS: 0 as Fp,
      strength: 0 as Fp,
      defense: 0 as Fp,
      supply: 0 as Fp,
    });
  }
  for (const cityId of sortedUnique(input.supplyCityIds)) {
    actions.push({
      kind: 'rebuildSupply',
      order: order++,
      targetId: cityId,
      costGold: 0 as Fp,
      upkeepGoldPerS: 0 as Fp,
      incomeGoldPerS: 0 as Fp,
      strength: 0 as Fp,
      defense: 0 as Fp,
      supply: 0 as Fp,
    });
  }
  for (const rate of input.taxRates) {
    actions.push({
      kind: 'setTax',
      order: order++,
      targetId: 0,
      rate,
      costGold: 0 as Fp,
      upkeepGoldPerS: 0 as Fp,
      incomeGoldPerS: 0 as Fp,
      strength: 0 as Fp,
      defense: 0 as Fp,
      supply: 0 as Fp,
    });
  }
  for (const army of [...input.armies].sort((a, b) => a.id - b.id)) {
    if (!army.hasEnemyFront) continue;
    actions.push({
      kind: army.offensive ? 'stopOffensive' : 'startOffensive',
      order: order++,
      targetId: army.id,
      costGold: 0 as Fp,
      upkeepGoldPerS: 0 as Fp,
      incomeGoldPerS: 0 as Fp,
      strength: 0 as Fp,
      defense: 0 as Fp,
      supply: 0 as Fp,
    });
  }
  return actions;
}
