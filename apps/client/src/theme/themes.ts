// Сгенерировано tools/tokens из docs/art/tokens.json — не редактировать вручную.

export const themeIds = ["soft","deco","glass","poster"] as const;

export type ThemeId = (typeof themeIds)[number];

export const defaultTheme: ThemeId = 'soft';
