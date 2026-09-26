// Режимы рисования планов армии в песочнице (07-controls.md, «Панель армий»): участок фронта,
// линия обороны, линия наступления. Тапы задают точки, путь подсвечивается, «Готово» — команда.
import {
  defenseLinePath,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  offensiveLinePath,
  TERRAIN,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

export type DraftMode = 'front' | 'line' | 'offensive';

/** Рисуемый план: режим, армия и точки-гексы по порядку тапов. */
export interface Draft {
  readonly mode: DraftMode;
  readonly armyId: number;
  readonly points: readonly number[];
}

/** Итог тапа: новый черновик (null — режим закончен) и команда, если план уже готов. */
export interface DraftStep {
  readonly draft: Draft | null;
  readonly cmd: Command | null;
}

// Соседний враг у гекса границы — против него участок фронта.
function enemyNear(map: MapStatic, view: PlayerView, hex: number): number {
  for (const n of neighbors(hexFromId(hex, map.width))) {
    if (!inBounds(n, map.width, map.height)) continue;
    const o = view.hexes.owner[hexId(n, map.width)] ?? -1;
    if (o >= 0 && o !== view.playerId) return o;
  }
  return -1;
}

/**
 * Тап в режиме рисования. Фронт: тап по земле соседа — вся граница с ним, два тапа по своей
 * границе — участок. Линии: тап добавляет точку.
 */
export function draftTap(map: MapStatic, view: PlayerView, d: Draft, hex: number): DraftStep {
  // Вода и чужие гексы для линии обороны точками не становятся — sim их всё равно отклонит.
  if (map.terrain[hex] === TERRAIN.water) return { draft: d, cmd: null };
  if (d.mode === 'line' && view.hexes.owner[hex] !== view.playerId) return { draft: d, cmd: null };
  if (d.mode !== 'front') {
    return d.points.at(-1) === hex
      ? { draft: d, cmd: null }
      : { draft: { ...d, points: [...d.points, hex] }, cmd: null };
  }
  const owner = view.hexes.owner[hex] ?? -1;
  if (owner >= 0 && owner !== view.playerId) {
    return {
      draft: null,
      cmd: { t: 'assignFront', armyId: d.armyId, enemyId: owner, section: null },
    };
  }
  if (owner !== view.playerId) return { draft: d, cmd: null };
  const [first] = d.points;
  if (first === undefined) return { draft: { ...d, points: [hex] }, cmd: null };
  const enemyId = enemyNear(map, view, first);
  return {
    draft: null,
    cmd: { t: 'assignFront', armyId: d.armyId, enemyId, section: [first, hex] },
  };
}

/** «Готово»: команда линии по точкам черновика; фронт завершается тапами, а не кнопкой. */
export function draftCommand(d: Draft): Command | null {
  if (d.points.length === 0) return null;
  if (d.mode === 'line') return { t: 'setDefenseLine', armyId: d.armyId, points: d.points };
  if (d.mode === 'offensive') {
    return { t: 'setOffensiveLine', armyId: d.armyId, points: d.points };
  }
  return null;
}

/** Гексы подсветки: путь линии между точками (как его достроит sim) или сами точки. */
export function draftPath(map: MapStatic, view: PlayerView, d: Draft): readonly number[] {
  const ground = { map, hexes: view.hexes };
  if (d.mode === 'line') return defenseLinePath(ground, view.playerId, d.points) ?? d.points;
  if (d.mode === 'offensive') return offensiveLinePath(ground, d.points) ?? d.points;
  return d.points;
}
