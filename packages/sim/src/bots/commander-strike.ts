// Удар по городу (CR-015; gdd/09-bots.md, «Путь ботов в commander»): свободные отряды армии бота
// идут на вражеский город, если прогноз боя — «победа». Цель выбирается по пользе (ценность города
// / расстояние), а не по ближайшей границе; сила — минимальный набор ближайших отрядов, которому
// прогноз обещает победу, остальные остаются на месте. Только армии ботов: люди командуют сами.
import type { Command } from '../commands/types.ts';
import type { MapStatic } from '../map/types.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { forecastBattle } from '../queries/forecast.ts';
import type { PlayerView } from '../queries/player-view.ts';
import type { UnitView } from '../queries/unit-view.ts';

/** Столица ценнее обычного города во столько раз: её потеря переносит столицу и бьёт по экономике. */
const CAPITAL_VALUE_MULT = 2;

interface Target {
  readonly hex: HexId;
  readonly value: number;
}

function targets(view: PlayerView): Target[] {
  return view.cities
    .filter((c) => c.owner >= 0 && c.owner !== view.playerId)
    .map((c) => ({ hex: c.hex, value: c.level * (c.isCapital ? CAPITAL_VALUE_MULT : 1) }));
}

/**
 * Приказы удара: каждому вражескому городу по пользе — минимальная сила, которая по прогнозу
 * побеждает; отряд участвует в одном ударе за решение.
 * @param free свободные отряды армии (без артиллерии: она в атаку не идёт)
 * @returns команды `move` на гекс города (последний шаг пути движение превращает в атаку)
 */
export function strike(map: MapStatic, view: PlayerView, free: readonly UnitView[]): Command[] {
  const out: Command[] = [];
  const used = new Set<number>();
  const at = (hex: HexId) => hexFromId(hex, map.width);
  const ranked = targets(view)
    .map((t) => {
      const nearest = Math.min(
        ...free.map((u) => distance(at(u.hex), at(t.hex))),
        Number.MAX_SAFE_INTEGER,
      );
      return { ...t, nearest };
    })
    .filter((t) => t.nearest < Number.MAX_SAFE_INTEGER)
    // Польза = ценность / (расстояние + 1); сравнение без деления, целыми числами.
    .sort((a, b) => b.value * (a.nearest + 1) - a.value * (b.nearest + 1) || a.hex - b.hex);
  for (const target of ranked) {
    const pool = free
      .filter((u) => !used.has(u.id))
      .sort(
        (a, b) =>
          distance(at(a.hex), at(target.hex)) - distance(at(b.hex), at(target.hex)) || a.id - b.id,
      );
    const force: UnitView[] = [];
    for (const unit of pool) {
      force.push(unit);
      const ids = force.map((u) => u.id);
      if (forecastBattle(map, view, ids, target.hex).outcome !== 'victory') continue;
      for (const u of force) used.add(u.id);
      out.push({ t: 'move', unitIds: ids, to: target.hex });
      break;
    }
  }
  return out;
}
