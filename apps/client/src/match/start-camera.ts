import type { Hex } from '@hexfront/sim';

import type { MapView } from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

export interface StartCameraOptions {
  readonly mapView: Pick<MapView, 'centerOn' | 'setScale'>;
  readonly playerCity: Hex;
  readonly playerUnitHexes: readonly Hex[];
  readonly nearbyHexes: readonly Hex[];
}

/** Центрирует стартовую область на городе игрока с масштабом операционного уровня. */
export function applyStartCamera(options: StartCameraOptions): void {
  const focusHexes = [options.playerCity, ...options.playerUnitHexes, ...options.nearbyHexes];
  if (focusHexes.length === 0) return;
  options.mapView.setScale(tokens.map.zoom.detailThresholds[1] ?? tokens.map.zoom.max);
  options.mapView.centerOn(options.playerCity);
}
