// Производные цвета из токенов (tokens.json): сами цвета не задаются, только вычисляются.
import { tokens } from './tokens.ts';

/** Смешивает цвет с белым: f — доля белого (territory.fillMix). */
export function mixWithWhite(hex: string, f: number): string {
  const ch = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `#${ch
    .map((c) =>
      Math.round(c * (1 - f) + 255 * f)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Цвет линий игрока (дороги, границы) по id; нейтральный — для отсутствующего. */
export function playerLine(playerId: number): string {
  return tokens.players.palette[playerId]?.line ?? tokens.neutral.line;
}

/** Заливка территории игрока: line + белый в доле territory.fillMix. */
export function playerFill(playerId: number): string {
  return mixWithWhite(playerLine(playerId), tokens.territory.fillMix);
}

/**
 * Цвет армии (style-guide, «Армии»): палитра игроков без цвета самого игрока, по порядку
 * создания армий (номер армии), по кругу.
 */
export function armyColor(playerId: number, armyNumber: number): string {
  const own = tokens.players.palette[playerId]?.line;
  const pool = tokens.players.palette.map((p) => p.line).filter((c) => c !== own);
  const index = (((armyNumber - 1) % pool.length) + pool.length) % pool.length;
  return pool[index] ?? tokens.neutral.line;
}
