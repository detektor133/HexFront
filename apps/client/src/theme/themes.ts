// Сгенерировано tools/tokens из docs/art/tokens.json — не редактировать вручную.

export const themeIds = ["soft","glass","glassLight","mint","peach","lavender","sky","graphite","forest","ink"] as const;

export type ThemeId = (typeof themeIds)[number];

export const defaultTheme: ThemeId = 'soft';
