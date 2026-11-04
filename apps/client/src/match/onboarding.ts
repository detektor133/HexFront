/**
 * Обучение первого матча: шаги о том, как управлять игрой. Каждый шаг показывает мышь с
 * подсвеченной кнопкой — левой, правой или колесом — и коротко говорит, что она делает.
 */
export type TutorialButton = 'none' | 'left' | 'right' | 'wheel' | 'drag';

export interface TutorialStep {
  readonly id: string;
  readonly button: TutorialButton;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: 'expand', button: 'none' },
  { id: 'enemy', button: 'right' },
  { id: 'neutral', button: 'right' },
  { id: 'select', button: 'left' },
  { id: 'order', button: 'right' },
  { id: 'own', button: 'left' },
  { id: 'camera', button: 'wheel' },
];

/** Следующий шаг или `null`, когда обучение закончено. */
export function nextStep(index: number): number | null {
  return index + 1 < TUTORIAL_STEPS.length ? index + 1 : null;
}

/** Предыдущий шаг; на первом остаётся первый. */
export function prevStep(index: number): number {
  return Math.max(0, index - 1);
}
