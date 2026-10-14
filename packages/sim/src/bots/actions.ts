import type { CommandOption } from './options/types.ts';

/**
 * Вариант команды, который мозг получает из реестра без знания его вида.
 * @returns команда, группа выбора и изменения признаков в fixed-point
 */
export type BotAction = CommandOption;
