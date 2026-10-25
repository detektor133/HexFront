import type { DetailLevel } from './camera.ts';
import { tokens } from '../theme/tokens.ts';

export interface TerrainRedrawGate {
  shouldRedraw(scale: number, level: DetailLevel, nowMs: number): boolean;
  reset(): void;
}

/**
 * Не даёт тяжёлой геометрии рельефа блокировать каждый кадр плавного зума.
 * После паузы паттерны один раз выравниваются по физическим пикселям конечного масштаба.
 */
export function createTerrainRedrawGate(): TerrainRedrawGate {
  let observedScale: number | null = null;
  let renderedScale: number | null = null;
  let renderedLevel: DetailLevel | null = null;
  let changedAtMs = 0;

  return {
    shouldRedraw(scale, level, nowMs) {
      if (observedScale !== scale) {
        observedScale = scale;
        changedAtMs = nowMs;
      }

      const isFirstFrame = renderedScale === null;
      const didLevelChange = renderedLevel !== null && renderedLevel !== level;
      const didZoomSettle = renderedScale !== scale && nowMs - changedAtMs >= tokens.motion.ui;
      if (!isFirstFrame && !didLevelChange && !didZoomSettle) return false;

      renderedScale = scale;
      renderedLevel = level;
      return true;
    },
    reset() {
      observedScale = null;
      renderedScale = null;
      renderedLevel = null;
      changedAtMs = 0;
    },
  };
}
