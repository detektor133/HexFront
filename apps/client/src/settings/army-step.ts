// Шаг кнопок «+/−» армии, %: выбирается в настройках и на карточке армии, хранится в браузере.
import { useEffect, useState } from 'react';

import { DEFAULT_STEP, STEP_CHOICES, type StepPct } from '../dev/army-limit.ts';

const KEY = 'hexfront.armyStep';
const listeners = new Set<() => void>();
let memory: StepPct | null = null;

/** Сохранённый шаг игрока или шаг по умолчанию. */
export function readArmyStep(): StepPct {
  if (memory !== null) return memory;
  try {
    const saved = Number(localStorage.getItem(KEY));
    return STEP_CHOICES.find((pct) => pct === saved) ?? DEFAULT_STEP;
  } catch {
    return DEFAULT_STEP;
  }
}

/** Запоминает шаг и оповещает подписчиков: карточка армии и настройки видят одно значение. */
export function writeArmyStep(pct: StepPct): void {
  try {
    localStorage.setItem(KEY, String(pct));
    memory = null;
  } catch {
    // Хранилище закрыто: выбор действует до перезагрузки страницы.
    memory = pct;
  }
  for (const listener of listeners) listener();
}

/** Шаг армии и его запись; компонент перерисовывается при смене. */
export function useArmyStep(): readonly [StepPct, (pct: StepPct) => void] {
  const [value, setValue] = useState<StepPct>(readArmyStep);
  useEffect(() => {
    const listener = (): void => setValue(readArmyStep());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return [value, writeArmyStep];
}
