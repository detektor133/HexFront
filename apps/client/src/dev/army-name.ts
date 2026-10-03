// Название армии: имя игрока или «N-я армия» (05-armies.md, «Модель»).
import type { ArmyView } from '@hexfront/sim';

import { t } from '../i18n/dict.ts';

export const MAX_ARMY_NAME_LENGTH = 20;

/** Имя армии для интерфейса. */
export function armyName(a: ArmyView): string {
  return a.name !== '' ? a.name : t('army.numbered').replace('{n}', String(a.number));
}

/** Нормализует ввод имени перед отправкой команды армии. */
export function normalizeArmyName(name: string): string {
  const limited = name.slice(0, MAX_ARMY_NAME_LENGTH);
  return limited.trim() === '' ? '' : limited;
}
