// Какие действия показать в карточке выбранного гекса (ui.md, «Карточка выбранного»):
// только возможные; «не хватает золота» — с ценой; недоступные по правилам — скрыты.
import type { Command, ConstructionCheck } from '@hexfront/sim';

import type { Selection } from '../local/messages.ts';

export type ActionKind = 'upgrade' | 'rebuild' | 'foundCity' | 'improve' | 'fort' | 'depot';

export interface HexAction {
  readonly kind: ActionKind;
  /** Цена, fixed-point золота. */
  readonly cost: number;
  readonly affordable: boolean;
  readonly cmd: Command;
}

function fromCheck(kind: ActionKind, check: ConstructionCheck, cmd: Command): HexAction | null {
  if (check.ok) return { kind, cost: check.cost, affordable: true, cmd };
  if (check.reason === 'notEnoughGold' && check.cost !== undefined) {
    return { kind, cost: check.cost, affordable: false, cmd };
  }
  return null;
}

/**
 * Действия для карточки. Чужой или нейтральный гекс и гекс со стройкой — без действий.
 * @returns список в порядке показа
 */
export function visibleActions(
  s: Selection,
  owner: number,
  humanId: number,
  busy: boolean,
): HexAction[] {
  if (owner !== humanId || busy) return [];
  const hex = s.hex;
  const out: (HexAction | null)[] = [];
  const city = s.city;
  if (city) {
    out.push(fromCheck('upgrade', city.upgrade, { t: 'upgradeCity', cityId: city.id }));
    const r = city.rebuild;
    if (r?.ok) {
      out.push({
        kind: 'rebuild',
        cost: r.cost,
        affordable: r.affordable,
        cmd: { t: 'rebuildSupply', cityId: city.id },
      });
    }
  } else {
    out.push(fromCheck('foundCity', s.foundCity, { t: 'foundCity', hex }));
    out.push(fromCheck('improve', s.improve, { t: 'improve', hex }));
    out.push(fromCheck('fort', s.fort, { t: 'build', hex, kind: 'fort' }));
  }
  out.push(fromCheck('depot', s.depot, { t: 'build', hex, kind: 'depot' }));
  return out.filter((a): a is HexAction => a !== null);
}
