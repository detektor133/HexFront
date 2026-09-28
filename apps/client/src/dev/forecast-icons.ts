// Иконки исхода боя для плашки прогноза (art/units.md, «Плашка прогноза»): без Pixi — их рисует
// и плашка на карте, и лист иконок на утверждение владельцу (04/T16).
import type { ForecastOutcome } from '@hexfront/sim';

/**
 * Иконки исхода в сетке 14×14: успех — галочка, упорно — «равно» (силы равны), провал — крест.
 * Ломаные: точки [x, y, x, y, …].
 */
export const OUTCOME_ICON: Record<ForecastOutcome, readonly (readonly number[])[]> = {
  victory: [[2, 7, 6, 11, 12, 3]],
  stalemate: [
    [3, 5, 11, 5],
    [3, 9, 11, 9],
  ],
  defeat: [
    [3, 3, 11, 11],
    [11, 3, 3, 11],
  ],
};
