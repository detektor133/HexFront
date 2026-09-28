// Кнопки наступления ▶ «Начать» и ■ «Стоп» на карточке армии (07-controls.md, «Панель армий»).

/** Кнопки наступления на карточке армии: какая из ▶/■ активна; null — линии наступления нет. */
export function offensiveButtons(
  offensive: { readonly active: boolean } | null,
): { readonly start: boolean; readonly stop: boolean } | null {
  if (!offensive) return null;
  return { start: !offensive.active, stop: offensive.active };
}
