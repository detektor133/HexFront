// Кнопки наступления ▶ «Начать» и ■ «Стоп» на карточке армии (07-controls.md, «Панель армий»).

/** Армия с автокомандованием: есть ли фронт и нажата ли ▶ без линии (линию строит commander). */
export interface AutoRun {
  readonly front: boolean;
  readonly wanted: boolean;
}

/**
 * Кнопки наступления на карточке армии: какая из ▶/■ активна; null — кнопок нет. У армии с auto
 * ▶ есть и без линии (CR-006): без фронта приглушена, после нажатия активна ■.
 */
export function offensiveButtons(
  offensive: { readonly active: boolean } | null,
  auto?: AutoRun,
): { readonly start: boolean; readonly stop: boolean } | null {
  if (offensive) return { start: !offensive.active, stop: offensive.active };
  if (!auto) return null;
  return { start: auto.front && !auto.wanted, stop: auto.wanted };
}
