import type { Command } from '../../commands/types.ts';
import type { Fp } from '../../math/int.ts';
import type { MatchState } from '../../state/types.ts';
import type { BotTickContext } from '../context.ts';

export interface UnitOptionDefinition {
  readonly costGoldPerSoldier: Fp;
  readonly upkeepGoldPerSoldierS: Fp;
  readonly upkeepGoldPerUnitS: Fp;
  readonly attack: Fp;
  readonly defense: Fp;
  readonly supplyPerSoldier: Fp;
}

export interface BuildingOptionDefinition {
  readonly costGold: Fp;
  readonly defenseMult: Fp;
  readonly supplyLossMult: Fp;
  readonly supplyRadius: number;
}

export interface BotOptionDefinitions {
  readonly units: Readonly<Record<string, UnitOptionDefinition>>;
  readonly buildings: Readonly<Record<string, BuildingOptionDefinition>>;
}

export interface CommandOption {
  readonly command: Command;
  readonly group: string;
  readonly effects: Readonly<Record<string, Fp>>;
}

export interface CommandOptionEntry {
  readonly kind: CommandOption['command']['t'];
  readonly options: (
    state: MatchState,
    playerId: number,
    context: BotTickContext,
    definitions: BotOptionDefinitions,
  ) => readonly CommandOption[];
}
