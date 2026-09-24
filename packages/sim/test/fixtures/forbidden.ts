// Фикстура нарочно нарушает правила sim: её должны отклонить ESLint и dependency-cruiser.
import { clientMarker } from '../../../../apps/client/src/index.ts';

export const roll = Math.random();
export const marker = clientMarker;
