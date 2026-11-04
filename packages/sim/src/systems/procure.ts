// Закупка под заказ численности армии (07-controls.md, «Меню страны»): армия с `wanted` сначала
// берёт свободный резерв, а недостающее раз в секунду заказывает набором в ближайшем к своему
// фронту городе с пустой очередью; отряд приходит прямо в армию и сам идёт на место по линии.
import { PROCURE_BATCH, RECRUIT_MIN, RECRUIT_STEP, TICKS_PER_S } from '../balance.ts';
import { checkRecruit, startRecruit } from '../commands/recruit.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, intDiv, type Fp } from '../math/int.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { planHexes } from '../state/front.ts';
import type { Army, City, MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

// Гексы, к которым город тянется: линия плана армии, иначе места её отрядов.
function anchors(state: MatchState, army: Army): HexId[] {
  const plan = state.plans.find((p) => p.armyId === army.id);
  if (plan) return planHexes(state, plan);
  return allUnits(state)
    .filter((u) => u.armyId === army.id)
    .map((u) => u.hex);
}

function cityOrder(state: MatchState, army: Army): City[] {
  const { width } = state.map;
  const marks = anchors(state, army).map((h) => hexFromId(h, width));
  const away = (c: City): number =>
    marks.length === 0 ? 0 : Math.min(...marks.map((m) => distance(m, hexFromId(c.hex, width))));
  return state.cities
    .filter((c) => c.owner === army.owner && !state.recruits.some((r) => r.cityId === c.id))
    .sort((a, b) => away(a) - away(b) || a.id - b.id);
}

const strength = (state: MatchState, army: Army): number =>
  allUnits(state)
    .filter((u) => u.armyId === army.id)
    .reduce((sum, u) => sum + u.soldiers, 0) +
  state.recruits.filter((r) => r.armyId === army.id).reduce((sum, r) => sum + r.soldiers, 0);

// Резерв игрока — в армии с нехваткой, ближайшие к её фронту отряды раньше.
function takeReserve(state: MatchState, army: Army): void {
  const { width } = state.map;
  const marks = anchors(state, army).map((h) => hexFromId(h, width));
  const away = (hex: HexId): number =>
    marks.length === 0 ? 0 : Math.min(...marks.map((m) => distance(m, hexFromId(hex, width))));
  const reserve = allUnits(state)
    .filter(
      (u) =>
        u.owner === army.owner &&
        u.armyId === null &&
        u.order === 'idle' &&
        !u.inBattle &&
        u.slot !== SLOT_DETACHED,
    )
    .sort((a, b) => away(a.hex) - away(b.hex) || a.id - b.id);
  let have = strength(state, army);
  for (const u of reserve) {
    if (have >= (army.wanted ?? 0) * FP) return;
    u.armyId = army.id;
    have += u.soldiers;
  }
}

/** Добирает резерв и закупает недостающих для армий с заказанной численностью; раз в секунду. */
export function procure(state: MatchState): void {
  if (state.tick % TICKS_PER_S !== 0) return;
  // Справедливо: сначала армия с наименьшей долей заказа — иначе первая по id забирает резерв и
  // очередь единственного города, а остальные направления стоят пустыми.
  const wanting = state.armies
    .filter((a) => a.wanted !== undefined && a.dir?.mode !== 'idle')
    .sort((a, b) => {
      const left = strength(state, a) * (b.wanted ?? 1);
      const right = strength(state, b) * (a.wanted ?? 1);
      return left - right || a.id - b.id;
    });
  for (const army of wanting) {
    if (army.wanted === undefined) continue;
    takeReserve(state, army);
    const deficit = army.wanted * FP - strength(state, army);
    if (deficit < RECRUIT_MIN) continue;
    const batch = intDiv(Math.min(deficit, PROCURE_BATCH), RECRUIT_STEP) * RECRUIT_STEP;
    let done = false;
    for (const city of cityOrder(state, army)) {
      for (let amount = batch; amount >= RECRUIT_MIN && !done; amount -= RECRUIT_STEP) {
        if (!checkRecruit(state, army.owner, city.id, 'infantry', amount as Fp).ok) continue;
        startRecruit(state, army.owner, city.id, 'infantry', amount as Fp, army.id);
        done = true;
      }
      if (done) break;
    }
  }
}
