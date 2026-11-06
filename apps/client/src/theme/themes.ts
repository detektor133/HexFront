// Сгенерировано tools/tokens из docs/art/tokens.json — не редактировать вручную.

export const themeIds = ["mint","hoi","civ","kingdom"] as const;

export type ThemeId = (typeof themeIds)[number];

export const defaultTheme: ThemeId = 'mint';
