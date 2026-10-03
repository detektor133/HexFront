// Карта и владельцы гексов — общее у состояния матча и снимка игрока: геометрия линий планов
// считается одинаково в sim и в превью клиента.
import type { MapStatic } from '../map/types.ts';

/** Карта и владельцы гексов. */
export interface LineGround {
  readonly map: MapStatic;
  readonly hexes: { readonly owner: Int16Array };
}
