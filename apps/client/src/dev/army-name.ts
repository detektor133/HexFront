// Название армии: имя игрока или «N-я армия» (05-armies.md, «Модель»).
import type { ArmyView } from '@hexfront/sim';

import { t } from '../i18n/dict.ts';

/** Имя армии для интерфейса. */
export function armyName(a: ArmyView): string {
  return a.name !== '' ? a.name : t('army.numbered').replace('{n}', String(a.number));
}
