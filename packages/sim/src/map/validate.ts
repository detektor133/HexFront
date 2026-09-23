// Правила карты поверх структуры: суша под городами, дистанции, проходимость спавнов.
// GDD: docs/gdd/01-map.md — «Местность», «Объекты на карте при старте».
import { CITY_MIN_DISTANCE } from '../balance.ts';
import { FEATURE, TERRAIN, TERRAIN_NAMES, type MapStatic } from './types.ts';
import { distance, hexFromId, hexId, type Hex } from '../math/hex.ts';

interface Site extends Hex {
  readonly label: string;
}

const terrainAt = (map: MapStatic, h: Hex): number => map.terrain[hexId(h, map.width)] ?? 0;
const nameOf = (code: number): string => TERRAIN_NAMES[code] ?? String(code);

// Спавн — место будущей столицы, поэтому он участвует в правиле дистанции между городами.
function citySites(map: MapStatic): Site[] {
  return [
    ...map.cities.map((c) => ({ q: c.q, r: c.r, label: `город «${c.name}» (id ${c.id})` })),
    ...map.spawns.map((s, i) => ({ q: s.q, r: s.r, label: `спавн #${i}` })),
  ];
}

function checkSites(map: MapStatic, errors: string[]): void {
  const sites = citySites(map);
  for (const s of sites) {
    if (terrainAt(map, s) === TERRAIN.water) {
      errors.push(`${s.label} (${s.q}, ${s.r}) стоит на воде`);
    }
  }
  sites.forEach((a, i) => {
    for (const b of sites.slice(i + 1)) {
      const d = distance(a, b);
      if (d < CITY_MIN_DISTANCE) {
        errors.push(`${a.label} и ${b.label}: дистанция ${d}, минимум ${CITY_MIN_DISTANCE}`);
      }
    }
  });
}

function checkHexLayers(map: MapStatic, errors: string[]): void {
  map.terrain.forEach((t, id) => {
    const h = hexFromId(id, map.width);
    const feature = map.features[id] ?? FEATURE.none;
    if (t === TERRAIN.water && feature !== FEATURE.none) {
      errors.push(`особый гекс (${h.q}, ${h.r}) на воде`);
    }
    if (feature === FEATURE.pass && t !== TERRAIN.mountains) {
      errors.push(`перевал (${h.q}, ${h.r}) не в горах, а на «${nameOf(t)}»`);
    }
    // Дороги не идут по воде и горам, кроме перевалов (01-map.md, «Дороги»).
    const roadBlocked =
      t === TERRAIN.water || (t === TERRAIN.mountains && feature !== FEATURE.pass);
    if (map.roads[id] === 1 && roadBlocked) {
      errors.push(`дорога (${h.q}, ${h.r}) на непроходимой для дорог местности «${nameOf(t)}»`);
    }
  });
}

/**
 * Проверяет правила карты, которые не следуют из структуры JSON.
 * @returns список ошибок; пустой — карта корректна
 */
export function validateMap(map: MapStatic): string[] {
  const errors: string[] = [];
  if (map.spawns.length === 0) errors.push('на карте нет ни одного спавна');
  checkSites(map, errors);
  checkHexLayers(map, errors);
  return errors;
}
