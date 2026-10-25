import { FP, fp, type PlayerView } from '@hexfront/sim';

export interface HudPreview {
  readonly population: number;
  readonly populationRate: number;
  readonly gold: number;
  readonly goldRate: number;
}

function readInteger(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Читает полный сценарий проверки HUD; неполный набор не меняет матч. */
export function readHudPreview(search: string): HudPreview | null {
  const params = new URLSearchParams(search);
  const population = readInteger(params, 'hudPop');
  const populationRate = readInteger(params, 'hudPopRate');
  const gold = readInteger(params, 'hudGold');
  const goldRate = readInteger(params, 'hudGoldRate');
  if (population === null || populationRate === null || gold === null || goldRate === null) {
    return null;
  }
  return { population, populationRate, gold, goldRate };
}

/** Подставляет значения только в представление локального dev-матча. */
export function applyHudPreview(view: PlayerView, preview: HudPreview | null): PlayerView {
  if (!preview) return view;
  return {
    ...view,
    players: view.players.map((player) =>
      player.id === view.playerId ? { ...player, gold: fp(preview.gold) } : player,
    ),
    me: {
      ...view.me,
      popTotal: preview.population * FP,
      popGrowthPerS: preview.populationRate * FP,
      incomePerS: Math.max(preview.goldRate, 0) * FP,
      upkeepPerS: Math.max(-preview.goldRate, 0) * FP,
    },
  };
}
